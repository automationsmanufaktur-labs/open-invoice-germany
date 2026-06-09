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
import { computeLineNetCents } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { finalizeWithinTx } from "@/domain/invoice/finalize";
import { advanceDate, type RecurInterval } from "@/lib/recurring";
import { RecurringError } from "./create";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunOptions {
  now?: Date;
  actor?: string;
}

export interface EmittedInvoice {
  invoiceId: string;
  number: string | null;
  periodDate: Date;
  finalized: boolean;
}

/** Erzeugt genau EINE Rechnung für die aktuelle Periode und schiebt das Abo weiter. */
async function emitOne(recurringId: string, now: Date, actor: string): Promise<{ result: EmittedInvoice; ended: boolean }> {
  return dbInternal.$transaction(async (tx) => {
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
      lineNetCents: computeLineNetCents(l.quantityMilli, l.unitNetPriceCents, l.discountPermille),
    }));
    const totals = computeTaxBreakdown(
      lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    );

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
        recurringInvoiceId: rec.id,
        netTotalCents: totals.netTotalCents,
        taxTotalCents: totals.taxTotalCents,
        grossTotalCents: totals.grossTotalCents,
        taxBreakdownJson: JSON.stringify(totals.breakdown),
        lines: { create: lines },
      },
    });

    await appendChangeLog(tx, {
      orgId: rec.orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "CREATE",
      actor,
      at: now,
      diff: { recurring: rec.id, period: periodDate.toISOString(), grossTotalCents: totals.grossTotalCents },
    });

    let number: string | null = invoice.number;
    let finalized = false;
    if (rec.autoFinalize) {
      const fin = await finalizeWithinTx(tx, invoice.id, { now, actor });
      number = fin.number;
      finalized = true;
    }

    const next = advanceDate(periodDate, rec.interval as RecurInterval, rec.intervalCount, rec.anchorDay);
    const ended = rec.endDate ? next > rec.endDate : false;
    await tx.recurringInvoice.update({
      where: { id: rec.id },
      data: {
        nextRunDate: next,
        lastRunAt: now,
        issuedCount: { increment: 1 },
        status: ended ? "ENDED" : "ACTIVE",
      },
    });

    return { result: { invoiceId: invoice.id, number, periodDate, finalized }, ended };
  });
}

/** Manuell: erzeugt sofort die nächste fällige Rechnung eines Abos (ignoriert den Stichtag). */
export async function emitRecurringNow(recurringId: string, opts: RunOptions = {}): Promise<EmittedInvoice> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";
  const { result } = await emitOne(recurringId, now, actor);
  return result;
}

export interface RecurringRunSummary {
  recurringId: string;
  title: string;
  emitted: EmittedInvoice[];
}

/**
 * Batch-Lauf (Cron): erzeugt für alle ACTIVE-Abos mit `nextRunDate <= now` die
 * fälligen Rechnungen — bei Rückstand mehrere, gedeckelt durch `maxPerAbo`.
 */
export async function runDueRecurring(
  opts: RunOptions & { orgId?: string; maxPerAbo?: number } = {},
): Promise<RecurringRunSummary[]> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "recurring-runner";
  const max = opts.maxPerAbo ?? 24;

  const due = await dbInternal.recurringInvoice.findMany({
    where: { status: "ACTIVE", nextRunDate: { lte: now }, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    select: { id: true, title: true },
    orderBy: { nextRunDate: "asc" },
  });

  const summaries: RecurringRunSummary[] = [];
  for (const rec of due) {
    const emitted: EmittedInvoice[] = [];
    for (let i = 0; i < max; i++) {
      const cur = await dbInternal.recurringInvoice.findUnique({
        where: { id: rec.id },
        select: { status: true, nextRunDate: true },
      });
      if (!cur || cur.status !== "ACTIVE" || cur.nextRunDate > now) break;
      const { result, ended } = await emitOne(rec.id, now, actor);
      emitted.push(result);
      if (ended) break;
    }
    summaries.push({ recurringId: rec.id, title: rec.title, emitted });
  }
  return summaries;
}
