/**
 * Erstellt die nächste Mahnstufe zu einer überfälligen, offenen Rechnung.
 * Stufe 0 = Zahlungserinnerung (ohne Zins/Gebühr), ab Stufe 1 Verzugszins
 * (§ 288 BGB) + 40-€-Pauschale (nur B2B, einmal je Forderung).
 */
import { dbInternal } from "@/lib/db";
import { defaultPrefix, formatDocumentNumber } from "@/domain/numbering";
import { computeDunning, daysBetween, DEFAULT_BASE_RATE_BP } from "@/lib/dunning";
import { appendChangeLog } from "@/domain/audit";
import { payableBaseCents } from "@/domain/invoice/amounts";

// B7 (Fix-Welle, Ruling Koordinator): Teil-/Abschlags-/Schlussrechnungen sind reguläre,
// enforceable Forderungen und muessen mahnbar sein wie eine normale Rechnung.
const DUNNABLE_TYPES = new Set(["INVOICE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);

export class DunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DunningError";
  }
}

export interface DunningOptions {
  actor?: string;
  now?: Date;
  dueInDays?: number; // neue Zahlungsfrist (Default 14)
  baseRateBp?: number; // aktuellen Basiszinssatz übergeben (Default 1,27 %)
  lateFeeCents?: number; // konkrete Kosten (kein pauschaler AGB-Betrag!)
}

export async function createDunning(invoiceId: string, opts: DunningOptions = {}) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { customer: { select: { type: true } }, dunnings: { select: { level: true, flatFee40Cents: true } } },
    });
    if (!inv) throw new DunningError("Rechnung nicht gefunden.");
    if (!DUNNABLE_TYPES.has(inv.type)) throw new DunningError("Nur Rechnungen können gemahnt werden.");
    if (inv.status === "DRAFT") throw new DunningError("Die Rechnung muss zuerst festgeschrieben werden.");
    if (inv.status === "CANCELLED") throw new DunningError("Die Rechnung ist storniert.");
    if (inv.status === "PAID") throw new DunningError("Die Rechnung ist bereits vollständig bezahlt.");

    // B7 (Fix-Welle): Bemessungsgrundlage wie bei Zahlung/Skonto (`payableBaseCents`) —
    // bei einer Schlussrechnung ist das der Rest nach Abzug der Abschlaege, nicht die
    // Gesamtleistung (sonst wuerde bereits bezahltes/verrechnetes erneut gemahnt).
    const openAmount = payableBaseCents(inv) - inv.paidAmountCents;
    if (openAmount <= 0) throw new DunningError("Kein offener Betrag.");

    const dueDate = inv.dueDate ?? inv.issueDate;
    const daysOverdue = daysBetween(dueDate, now);
    if (daysOverdue <= 0) throw new DunningError("Die Rechnung ist noch nicht überfällig.");

    const level = inv.dunnings.length; // 0 = Zahlungserinnerung
    const isConsumer = inv.customer.type === "CONSUMER";
    const baseRateBp = opts.baseRateBp ?? DEFAULT_BASE_RATE_BP;
    const charging = level >= 1;
    const alreadyHasFlat = inv.dunnings.some((d) => d.flatFee40Cents > 0);
    const applyFlatFee = charging && !isConsumer && !alreadyHasFlat;

    const calc = computeDunning({ openAmountCents: openAmount, daysOverdue, isConsumer, baseRateBp, applyFlatFee });
    const interestCents = charging ? calc.interestCents : 0;
    const flatFee = charging ? calc.flatFee40Cents : 0;
    const lateFeeCents = charging ? opts.lateFeeCents ?? 0 : 0;

    const year = now.getFullYear();
    const range = await tx.numberRange.upsert({
      where: { orgId_docType_year: { orgId: inv.orgId, docType: "DUNNING", year } },
      create: { orgId: inv.orgId, docType: "DUNNING", year, currentValue: 1, prefix: defaultPrefix("DUNNING") },
      update: { currentValue: { increment: 1 } },
    });
    const number = formatDocumentNumber(range.pattern, {
      prefix: range.prefix || defaultPrefix("DUNNING"),
      seq: range.currentValue,
      padding: range.seqPadding,
      year,
      month: now.getMonth() + 1,
      day: now.getDate(),
    });

    const newDueDate = new Date(now.getTime() + (opts.dueInDays ?? 14) * 24 * 60 * 60 * 1000);

    // Passende Mahnstufe (order = level) verknuepfen, falls konfiguriert. Fehlt eine Stufe
    // (z. B. weil ueber die vier Standardstufen hinaus gemahnt wird), bleibt stageId null.
    const stage = await tx.dunningStage.findUnique({
      where: { orgId_order: { orgId: inv.orgId, order: level } },
      select: { id: true },
    });

    const dunning = await tx.dunning.create({
      data: {
        invoiceId,
        number,
        level,
        stageId: stage?.id ?? null,
        sentAt: now,
        dueDate: newDueDate,
        baseInterestRatePermille: baseRateBp, // gespeichert in Basispunkten
        interestRatePoints: isConsumer ? 5 : 9,
        interestAmountCents: interestCents,
        lateFeeCents,
        flatFee40Cents: flatFee,
      },
    });

    await appendChangeLog(tx, {
      orgId: inv.orgId,
      entity: "INVOICE",
      entityId: invoiceId,
      action: "UPDATE",
      actor,
      at: now,
      diff: { dunning: number, level, interestCents, flatFee40Cents: flatFee },
    });

    return {
      dunning,
      openAmountCents: openAmount,
      totalCents: openAmount + interestCents + flatFee + lateFeeCents,
      daysOverdue,
      level,
    };
  });
}
