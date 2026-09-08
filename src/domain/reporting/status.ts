/**
 * Statusverteilung fuer Auswertungen/Grafiken (Phase 12e, Task 3, §54). Rein lesend,
 * org-scoped, reine Funktion ueber select-reduzierte Zeilen (kein DB-spezifisches
 * Aggregat — Global Constraint, siehe dashboard/summary.ts).
 *
 * Ergaenzt `dashboardSummary` um die dort fehlende PAID-Zahl (fürs Ringdiagramm) —
 * die Kacheln bleiben bei `dashboardSummary` (§1.4, kein Doppelbau).
 */
import { dbInternal } from "@/lib/db";
import { effectiveInvoiceStatus, INVOICE_STATUS_LABEL, type EffectiveInvoiceStatus } from "@/domain/invoice/status";
import { openAmountCents } from "@/domain/invoice/amounts";

export interface StatusCount {
  status: EffectiveInvoiceStatus;
  label: string;
  count: number;
  openCents: number;
}

/** Status, fuer die ein offener Betrag ausgewiesen wird — PAID/CANCELLED/DRAFT bleiben bei 0. */
const OPEN_STATUSES = new Set<EffectiveInvoiceStatus>(["OPEN", "DUE", "OVERDUE", "PARTIALLY_PAID"]);

/**
 * Zaehlt Rechnungen je effektivem Status (inkl. faellig/ueberfaellig-Ableitung) und
 * summiert den offenen Betrag je Status. Reihenfolge folgt `INVOICE_STATUS_LABEL`
 * (feste Anzeige-Reihenfolge); Status mit `count === 0` entfallen (keine leeren
 * Diagrammsegmente).
 */
export async function statusCounts(orgId: string, now: Date = new Date()): Promise<StatusCount[]> {
  const invoices = await dbInternal.invoice.findMany({
    where: { orgId },
    select: { status: true, dueDate: true, issueDate: true, grossTotalCents: true, paidAmountCents: true, payableCents: true },
  });

  const byStatus = new Map<EffectiveInvoiceStatus, { count: number; openCents: number }>();
  for (const inv of invoices) {
    const status = effectiveInvoiceStatus(inv, now);
    const entry = byStatus.get(status) ?? { count: 0, openCents: 0 };
    entry.count += 1;
    if (OPEN_STATUSES.has(status)) entry.openCents += openAmountCents(inv);
    byStatus.set(status, entry);
  }

  const order = Object.keys(INVOICE_STATUS_LABEL) as EffectiveInvoiceStatus[];
  return order
    .map((status) => {
      const entry = byStatus.get(status);
      return entry ? { status, label: INVOICE_STATUS_LABEL[status], count: entry.count, openCents: entry.openCents } : null;
    })
    .filter((row): row is StatusCount => row !== null);
}
