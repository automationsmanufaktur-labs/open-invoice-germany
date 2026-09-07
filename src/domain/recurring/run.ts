/**
 * Erzeugt aus Abos die fälligen Rechnungen.
 *
 * Pro Lauf entsteht je fälliger Periode ein regulärer Rechnungs-ENTWURF
 * (oder direkt festgeschrieben bei `autoFinalize`). Alles in EINER Transaktion
 * je Rechnung: Beleg + Audit-Eintrag + Fortschreiben des Abos sind atomar — ein
 * Fehler beim Festschreiben rollt die Erzeugung zurück (keine doppelte Vergabe,
 * kein „Loch").
 *
 * Datum: Rechnungsdatum = Erstellungstag (`now`), Leistungsdatum = Perioden-
 * Stichtag, fällig = `now` + Zahlungsziel. `nextRunDate` wird vom Stichtag aus
 * fortgeschrieben (nicht von `now`), damit der Rhythmus stabil bleibt.
 */
import { dbInternal } from "@/lib/db";
import { computeLineNet } from "@/lib/pricing/line";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { onRecurringFailed } from "@/domain/notifications/hooks";
import { linkDocuments } from "@/domain/relations";
import { finalizeWithinTx } from "@/domain/invoice/finalize";
import { advanceDate, type RecurInterval } from "@/lib/recurring";
import { formatDateDe } from "@/lib/template/format";
import { prefillEmail } from "@/domain/email/compose";
import { sendDocumentEmail } from "@/domain/email/send";
import type { MailProvider } from "@/lib/mail/provider";
import { RecurringError } from "./create";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunOptions {
  now?: Date;
  actor?: string;
  /** Provider-Injektion fuer Tests (Muster: `runDunningJob`) — Standard: echter SMTP-Versand. */
  provider?: MailProvider;
}

export interface EmittedInvoice {
  invoiceId: string;
  number: string | null;
  periodDate: Date;
  finalized: boolean;
  /** Ergebnis des automatischen Versands (autoSend, Phase 7, §33) — fehlt, wenn autoSend aus ist. */
  emailStatus?: "SENT" | "FAILED" | "SKIPPED";
  emailError?: string;
}

/**
 * Versendet die erzeugte Rechnung ueber die Standardvorlage INVOICE (autoSend, Phase 7,
 * §33) — LAEUFT AUSSERHALB jeder Prisma-Transaktion (Modulkommentar: kein SMTP-Aufruf
 * innerhalb einer Transaktion). Ohne Kunden-E-Mail oder Mailkonfiguration: SKIPPED statt
 * eines geworfenen Fehlers — der Lauf der uebrigen Abos darf nicht abbrechen.
 */
async function sendRecurringInvoiceEmail(
  orgId: string,
  invoiceId: string,
  provider: MailProvider | undefined,
  emailTemplateId: string | null,
): Promise<{ status: "SENT" | "FAILED" | "SKIPPED"; error?: string }> {
  try {
    // emailTemplateId (Phase 8b, §43): ohne Angabe greift weiterhin die Standardvorlage
    // INVOICE (prefillEmail waehlt sie selbst, wenn templateId undefined ist).
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId, templateId: emailTemplateId ?? undefined });
    if (pre.to.length === 0) return { status: "SKIPPED" };
    const result = await sendDocumentEmail(
      orgId,
      "recurring-runner",
      {
        docType: "INVOICE",
        docId: invoiceId,
        to: pre.to.join(","),
        cc: pre.cc.join(","),
        bcc: pre.bcc.join(","),
        subject: pre.subject,
        body: pre.body,
        signature: pre.signature,
        copyToSelf: pre.copyToSelf,
        standardAttachments: pre.defaultStandardAttachments,
        templateId: pre.templateId,
        warnings: pre.warnings,
      },
      [],
      provider,
    );
    return result.status === "SENT" ? { status: "SENT" } : { status: "FAILED", error: result.error };
  } catch (e) {
    return { status: "FAILED", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Erzeugt genau EINE Rechnung für die aktuelle Periode und schiebt das Abo weiter. */
async function emitOne(
  recurringId: string,
  now: Date,
  actor: string,
  provider?: MailProvider,
): Promise<{ result: EmittedInvoice; ended: boolean; autoSend: boolean; orgId: string; emailTemplateId: string | null }> {
  const created = await dbInternal.$transaction(async (tx) => {
    const rec = await tx.recurringInvoice.findUnique({
      where: { id: recurringId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!rec) throw new RecurringError("Abo nicht gefunden.");
    if (rec.status !== "ACTIVE") throw new RecurringError("Abo ist nicht aktiv.");
    if (rec.lines.length === 0) throw new RecurringError("Abo hat keine Positionen.");

    const periodDate = rec.nextRunDate;

    const lines = rec.lines.map((l, i) => ({
      position: i + 1,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitNetPriceCents: l.unitNetPriceCents,
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
      discountPermille: l.discountPermille,
      // W4 — dieselbe Rundung wie bei der manuellen Rechnung (computeLineNet aus
      // src/lib/pricing/line.ts): erst grossLineCents runden, dann den Prozentabzug
      // runden, statt in einem Schritt (computeLineNetCents rundete abweichend).
      lineNetCents: computeLineNet({
        quantityMilli: l.quantityMilli,
        unitNetPriceCents: l.unitNetPriceCents,
        discountPermille: l.discountPermille,
      }).lineNetCents,
    }));
    const totals = computeTaxBreakdown(
      lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    );

    // recurringInsertPeriodText (Phase 7, §33): Kopftext "Abrechnungszeitraum dd.mm.yyyy –
    // dd.mm.yyyy", nur wenn die Org-Einstellung aktiv ist. Periodenstart = ein Intervall
    // vor dem aktuellen Stichtag (negativer advanceDate-Aufruf, dieselbe Monats-/
    // Wochenklemmung wie beim Vorwaertsschieben).
    let headerText: string | undefined;
    // showPeriodText (Phase 8b, §43): das Abo-Feld ist ab jetzt allein massgeblich — der
    // Settings-Default (recurringInsertPeriodText) wird nur noch beim Anlegen des Abos
    // uebernommen (createRecurring), nicht mehr live bei jedem Lauf gelesen.
    if (rec.showPeriodText) {
      const periodStart = advanceDate(periodDate, rec.interval as RecurInterval, -rec.intervalCount, rec.anchorDay);
      headerText = `Abrechnungszeitraum ${formatDateDe(periodStart)} – ${formatDateDe(periodDate)}`;
    }

    const invoice = await tx.invoice.create({
      data: {
        orgId: rec.orgId,
        customerId: rec.customerId,
        type: "INVOICE",
        taxScheme: rec.taxScheme,
        currency: rec.currency,
        issueDate: now,
        deliveryDate: periodDate,
        dueDate: new Date(now.getTime() + rec.paymentTermsDays * DAY_MS),
        notes: rec.notes,
        headerText,
        recurringInvoiceId: rec.id,
        netTotalCents: totals.netTotalCents,
        taxTotalCents: totals.taxTotalCents,
        grossTotalCents: totals.grossTotalCents,
        taxBreakdownJson: JSON.stringify(totals.breakdown),
        lines: { create: lines },
      },
    });

    await linkDocuments(tx, { orgId: rec.orgId, fromType: "INVOICE", fromId: invoice.id, toType: "RECURRING", toId: rec.id, relationType: "GENERATED_BY" });

    await appendChangeLog(tx, {
      orgId: rec.orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "CREATE",
      actor,
      at: now,
      diff: { recurring: rec.id, period: periodDate.toISOString(), grossTotalCents: totals.grossTotalCents },
    });
    await logActivity(tx, { orgId: rec.orgId, entityType: "INVOICE", entityId: invoice.id, type: "CREATED", actor, at: now, data: { recurring: rec.id } });

    let number: string | null = invoice.number;
    let finalized = false;
    if (rec.autoFinalize) {
      const fin = await finalizeWithinTx(tx, invoice.id, { now, actor });
      number = fin.number;
      finalized = true;
    }

    const next = advanceDate(periodDate, rec.interval as RecurInterval, rec.intervalCount, rec.anchorDay);
    // issuedCount VOR dem Erhoehen im naechsten Schritt ist die Anzahl der bereits
    // vorherigen Laeufe — nach DIESEM Lauf steht die Anzahl bei issuedCount + 1
    // (Task-1-Brief: "maxRuns -> ENDED wenn issuedCount >= maxRuns NACH Lauf").
    const issuedCountAfter = rec.issuedCount + 1;
    const endedByDate = rec.endDate ? next > rec.endDate : false;
    const endedByMaxRuns = rec.maxRuns != null && issuedCountAfter >= rec.maxRuns;
    const ended = endedByDate || endedByMaxRuns;
    await tx.recurringInvoice.update({
      where: { id: rec.id },
      data: {
        nextRunDate: next,
        lastRunAt: now,
        issuedCount: { increment: 1 },
        status: ended ? "ENDED" : "ACTIVE",
      },
    });

    const result: EmittedInvoice = { invoiceId: invoice.id, number, periodDate, finalized };
    return { result, ended, autoSend: rec.autoSend, orgId: rec.orgId, emailTemplateId: rec.emailTemplateId };
  });

  // autoSend (Phase 7, §33): erst NACH der Transaktion versenden (Modulkommentar: kein
  // SMTP-Aufruf innerhalb einer Prisma-Transaktion). Ein Fehler beim Versand darf die
  // bereits erzeugte/festgeschriebene Rechnung nicht rueckabwickeln — er landet im Feld
  // `emailStatus`/`emailError` des Ergebnisses (Summary), niemals als geworfener Fehler.
  // S4 (Fix-Welle, Final-Review): zusaetzlich zu `autoSend` MUSS die Rechnung tatsaechlich
  // festgeschrieben sein (createRecurring erzwingt zwar autoFinalize bei autoSend, aber
  // ein Bestandsdatensatz aus der Zeit vor diesem Fix koennte autoSend=true/autoFinalize=false
  // noch kombiniert haben) — sonst ginge eine Rechnung mit Nummer/GiroCode "ENTWURF" raus.
  if (created.autoSend && created.result.finalized) {
    const sent = await sendRecurringInvoiceEmail(created.orgId, created.result.invoiceId, provider, created.emailTemplateId);
    created.result.emailStatus = sent.status;
    created.result.emailError = sent.error;
  }

  return created;
}

/** Manuell: erzeugt sofort die nächste fällige Rechnung eines Abos (ignoriert den Stichtag). */
export async function emitRecurringNow(recurringId: string, opts: RunOptions = {}): Promise<EmittedInvoice> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";
  const { result } = await emitOne(recurringId, now, actor, opts.provider);
  return result;
}

export interface RecurringRunSummary {
  recurringId: string;
  title: string;
  emitted: EmittedInvoice[];
  /** Fehlermeldung, falls der Lauf dieses Abos abgebrochen ist (Task-3-Ergaenzung: Fehler-
   *  Summary). Bereits erzeugte `emitted`-Eintraege bleiben gueltig — nur der naechste
   *  (fehlgeschlagene) Versuch dieses Abos wurde abgebrochen. */
  error?: string;
}

/**
 * Batch-Lauf (Cron): erzeugt für alle ACTIVE-Abos mit `nextRunDate <= now` die
 * fälligen Rechnungen — bei Rückstand mehrere, gedeckelt durch `maxPerAbo`.
 *
 * Fehler-Summary (Phase 8b, Task 3): ein Fehler beim Erzeugen EINES Abo-Laufs (z. B.
 * fehlende Pflichtangaben beim `autoFinalize`) brach frueher den GESAMTEN Batch ab — kein
 * try/catch um `emitOne`, ein einziges kaputtes Abo verhinderte die Rechnungen ALLER
 * anderen faelligen Abos in diesem Lauf. Jetzt: Fehler landen in `RecurringRunSummary.error`,
 * die Schleife faehrt mit dem naechsten Abo fort; `onRecurringFailed`
 * (`src/domain/notifications/hooks.ts`) benachrichtigt zusaetzlich die Organisation.
 */
export async function runDueRecurring(
  opts: RunOptions & { orgId?: string; maxPerAbo?: number } = {},
): Promise<RecurringRunSummary[]> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "recurring-runner";
  const max = opts.maxPerAbo ?? 24;

  const due = await dbInternal.recurringInvoice.findMany({
    where: { status: "ACTIVE", nextRunDate: { lte: now }, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    select: { id: true, title: true, orgId: true },
    orderBy: { nextRunDate: "asc" },
  });

  const summaries: RecurringRunSummary[] = [];
  for (const rec of due) {
    const emitted: EmittedInvoice[] = [];
    let error: string | undefined;
    try {
      for (let i = 0; i < max; i++) {
        const cur = await dbInternal.recurringInvoice.findUnique({
          where: { id: rec.id },
          select: { status: true, nextRunDate: true },
        });
        if (!cur || cur.status !== "ACTIVE" || cur.nextRunDate > now) break;
        const { result, ended } = await emitOne(rec.id, now, actor, opts.provider);
        emitted.push(result);
        if (ended) break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await onRecurringFailed(rec.orgId, { recurringId: rec.id, title: rec.title, message: error, at: now });
    }
    summaries.push({ recurringId: rec.id, title: rec.title, emitted, ...(error ? { error } : {}) });
  }
  return summaries;
}
