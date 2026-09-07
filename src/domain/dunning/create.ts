/**
 * Erstellt die naechste Mahnstufe zu einer ueberfaelligen, offenen Rechnung. Ab Phase 6
 * (Task 2) stufenbasiert (`DunningStage`, konfigurierbar) statt der fest verdrahteten
 * vier Level aus Phase <6 — Fristen/Zinsen/Gebuehren kommen aus der jeweiligen Stufe,
 * nicht mehr aus `opts`. `dunningScheduleFor` (schedule.ts, rein) entscheidet, welche
 * Stufe dran ist und ob sie bereits faellig ist.
 */
import { dbInternal } from "@/lib/db";
import { assignDocumentNumber } from "@/domain/numbering/ranges";
import { computeDunning } from "@/lib/dunning";
import { dunningScheduleFor, latestDunning, type StageLike } from "@/domain/dunning/schedule";
import { loadDunningSettings } from "@/domain/dunning/settings";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { openAmountCents as computeOpenAmountCents } from "@/domain/invoice/amounts";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { formatDateDe } from "@/lib/template/format";

// B7 (Fix-Welle, Ruling Koordinator): Teil-/Abschlags-/Schlussrechnungen sind reguläre,
// enforceable Forderungen und muessen mahnbar sein wie eine normale Rechnung.
// Exportiert fuer den Scheduler (Task 3, dunning/auto.ts) — dieselbe Kandidatenmenge,
// keine zweite, potenziell abweichende Liste.
export const DUNNABLE_TYPES = new Set(["INVOICE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);

export class DunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DunningError";
  }
}

export interface DunningOptions {
  actor?: string;
  now?: Date;
  /** Konkrete Zusatzkosten (kein pauschaler AGB-Betrag!), nur wirksam ab Stufe order >= 2. */
  lateFeeCents?: number;
  /** Manuelle Erstellung vor Faelligkeit der naechsten Stufe erzwingen. */
  force?: boolean;
  createdBy?: "user" | "scheduler" | "mcp" | "api";
}

interface DunningStageRow extends StageLike {
  id: string;
  name: string;
  feeCents: number;
  newDueDays: number;
  calculateInterest: boolean;
  includeB2BFlatFee: boolean;
}

export async function createDunning(invoiceId: string, opts: DunningOptions = {}) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";
  const force = opts.force ?? false;
  const createdBy = opts.createdBy ?? "user";

  const inv0 = await dbInternal.invoice.findUnique({ where: { id: invoiceId }, select: { orgId: true } });
  if (!inv0) throw new DunningError("Rechnung nicht gefunden.");
  // Basiszinssatz aus den org-weiten Mahnwesen-Einstellungen (Selbstheilung legt sie
  // bei Bedarf an) — AUSSERHALB der Transaktion, da hier nur gelesen wird und der Upsert
  // (Anlegen der Default-Zeile) keine GoBD-relevante Schreibaktion ist.
  const settings = await loadDunningSettings(inv0.orgId);

  return dbInternal.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        org: true,
        // Nit (Fix-Welle): kein `take: 1` mehr — `latestDunning` (schedule.ts) bestimmt
        // die "letzte Mahnung" jetzt einheitlich ueber alle drei Aufrufer hinweg (siehe
        // dort), nicht mehr per DB-seitigem orderBy+take.
        dunnings: {
          select: { createdAt: true, dueDate: true, sentAt: true, level: true, stage: { select: { order: true } } },
        },
      },
    });
    if (!inv) throw new DunningError("Rechnung nicht gefunden.");
    if (!DUNNABLE_TYPES.has(inv.type)) throw new DunningError("Nur Rechnungen können gemahnt werden.");
    if (inv.status === "DRAFT") throw new DunningError("Die Rechnung muss zuerst festgeschrieben werden.");
    if (inv.status === "CANCELLED") throw new DunningError("Die Rechnung ist storniert.");
    if (inv.status === "PAID") throw new DunningError("Die Rechnung ist bereits vollständig bezahlt.");

    // Mahnprozess-Status (Phase 6): PAUSED mit abgelaufener Frist wird in DERSELBEN
    // Transaktion wieder auf ACTIVE gesetzt (Neuerstellung darf dann stattfinden);
    // STOPPED ist dauerhaft und wirft immer; ACTIVE erlaubt normal weiter.
    let dunningState = inv.dunningState;
    if (dunningState === "STOPPED") {
      throw new DunningError("Der Mahnprozess dieser Rechnung wurde dauerhaft angehalten.");
    }
    if (dunningState === "PAUSED") {
      // S1 (Fix-Welle): `pausedUntil` ist am Schema (dunningStateInputSchema) fuer
      // state=PAUSED inzwischen Pflicht — ueber die API kann PAUSED ohne Datum also nicht
      // mehr entstehen. Dieser Zweig bleibt trotzdem defensiv: fehlt `dunningPausedUntil`
      // dennoch (z. B. Altdaten, direkter DB-Zugriff), BLOCKIERT er weiterhin (kein Datum
      // = kein belegbares Ende der Pause), statt die Pause stillschweigend aufzuheben und
      // die Mahnung trotzdem zu erstellen.
      if (!inv.dunningPausedUntil) {
        throw new DunningError("Der Mahnprozess ist pausiert (ohne Enddatum) — bitte zuerst ein Enddatum setzen oder aktiv schalten.");
      }
      if (inv.dunningPausedUntil.getTime() > now.getTime()) {
        throw new DunningError(`Der Mahnprozess ist bis ${formatDateDe(inv.dunningPausedUntil)} pausiert.`);
      }
      dunningState = "ACTIVE";
      await tx.invoice.update({ where: { id: invoiceId }, data: { dunningState: "ACTIVE", dunningPausedUntil: null } });
    }

    const openAmount = computeOpenAmountCents(inv);
    if (openAmount <= 0) throw new DunningError("Kein offener Betrag.");

    const dueDate = inv.dueDate ?? inv.issueDate;

    const stages: DunningStageRow[] = await tx.dunningStage.findMany({
      where: { orgId: inv.orgId },
      select: { id: true, name: true, order: true, enabled: true, daysAfterDue: true, feeCents: true, newDueDays: true, calculateInterest: true, includeB2BFlatFee: true },
    });
    const last = latestDunning(inv.dunnings);
    const lastOrder = last ? (last.stage?.order ?? last.level) : null;
    const schedule = dunningScheduleFor({
      invoiceDueDate: dueDate,
      lastDunning: last ? { order: lastOrder!, dueDate: last.dueDate, sentAt: last.sentAt } : null,
      stages,
      gracePeriodDays: settings.gracePeriodDays,
      now,
    });

    const stage = schedule.nextStage;
    if (!stage) throw new DunningError("Keine weitere Mahnstufe konfiguriert.");
    if (!schedule.isDue && !force) {
      throw new DunningError(`Nächste Mahnstufe erst ab ${formatDateDe(schedule.dueAt)} fällig.`);
    }

    const isConsumer = inv.customer.type === "CONSUMER";
    const charging = stage.order >= 2;
    // B1 (Fix-Welle): das `take: 1`-Fenster oben zeigt nur die LETZTE Mahnung — reicht
    // nicht, um "hoechstens einmal je Rechnung" zu pruefen (Stufe 3 saehe sonst nur Stufe 2,
    // die selbst schon 0 war, und wuerde die Pauschale ein zweites Mal buchen). Deshalb hier
    // ZUSAETZLICH ueber ALLE bisherigen Mahnungen dieser Rechnung zaehlen, in derselben Tx.
    const flatFeeCount = await tx.dunning.count({ where: { invoiceId, flatFee40Cents: { gt: 0 } } });
    const alreadyHasFlat = flatFeeCount > 0;
    const applyFlatFee = stage.includeB2BFlatFee && !isConsumer && !alreadyHasFlat;

    // Ruling (task-2-facts.md): Zinsen werden je Mahnung neu auf die Gesamt-Ueberfaelligkeit
    // seit RECHNUNGSFAELLIGKEIT berechnet (nicht kumulativ ab der letzten Mahnung) und
    // ersetzen den zuvor ausgewiesenen Betrag, statt ihn zu addieren.
    const calc = computeDunning({
      openAmountCents: openAmount,
      daysOverdue: schedule.daysOverdue,
      isConsumer,
      baseRateBp: settings.baseInterestRateBp,
      applyFlatFee,
    });
    const interestCents = stage.calculateInterest ? calc.interestCents : 0;
    const flatFee = calc.flatFee40Cents;
    const feeCents = charging ? stage.feeCents : 0;
    const lateFeeCents = charging ? (opts.lateFeeCents ?? 0) : 0;

    // B3 (Final-Review): ueber assignDocumentNumber() — siehe invoice/finalize.ts.
    const number = await assignDocumentNumber(tx, inv.orgId, "DUNNING", now);

    const newDueDate = new Date(now.getTime() + stage.newDueDays * 24 * 60 * 60 * 1000);

    const sellerSnapshotJson = JSON.stringify(buildSellerSnapshot(inv.org));
    const buyerSnapshotJson = JSON.stringify(buildBuyerSnapshot(inv.customer));

    const dunning = await tx.dunning.create({
      data: {
        invoiceId,
        number,
        level: stage.order,
        stageId: stage.id,
        sentAt: now,
        dueDate: newDueDate,
        baseInterestRatePermille: settings.baseInterestRateBp,
        interestRatePoints: isConsumer ? 5 : 9,
        interestAmountCents: interestCents,
        lateFeeCents,
        flatFee40Cents: flatFee,
        feeCents,
        claimBaseCents: openAmount,
        invoiceNumber: inv.number,
        invoiceDueDate: dueDate,
        sellerSnapshotJson,
        buyerSnapshotJson,
        snapshotSource: "CREATE",
        createdBy,
      },
    });

    await appendChangeLog(tx, {
      orgId: inv.orgId,
      entity: "INVOICE",
      entityId: invoiceId,
      action: "DUNNING_CREATE",
      actor,
      at: now,
      diff: {
        number,
        stage: stage.name,
        order: stage.order,
        claimBaseCents: openAmount,
        interestCents,
        flatFee40Cents: flatFee,
        feeCents,
        createdBy,
      },
    });
    await logActivity(tx, {
      orgId: inv.orgId,
      entityType: "INVOICE",
      entityId: invoiceId,
      type: "DUNNING_CREATED",
      actor,
      at: now,
      data: { number, stage: stage.name, order: stage.order },
    });

    return {
      dunning,
      openAmountCents: openAmount,
      totalCents: openAmount + interestCents + flatFee + feeCents + lateFeeCents,
      daysOverdue: schedule.daysOverdue,
      stage,
      // Rueckwaertskompatibel (Route/MCP, Task 3/4 passen die Aufrufer an): `level` war
      // vor Phase 6 das Feld, ueber das die Stufe identifiziert wurde.
      level: stage.order,
    };
  });
}
