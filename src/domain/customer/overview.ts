/**
 * Kunden-Detailseite (Phase 8b, Task 4, `/kunden/[id]`) — KPIs + Belegtabs. Nutzt
 * bewusst die bestehenden Listen-Domainfunktionen (Task 1) mit `customerId`-Filter statt
 * eigener Parallel-Queries (CLAUDE.md "Nichts doppelt bauen").
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { listInvoices, type InvoiceListRow } from "@/domain/invoice/list";
import { listQuotes, listDeliveryNotes, listRecurring, type QuoteListRow, type DeliveryNoteListRow, type RecurringListRow } from "@/domain/document/list";
import { effectiveInvoiceStatus } from "@/domain/invoice/status";
import { openAmountCents } from "@/domain/invoice/amounts";
import { signedRevenueShareCents } from "@/domain/reporting/revenue";

export interface CustomerOverviewKpis {
  openCents: number;
  overdueCents: number;
  totalRevenueCents: number;
  lastActivityAt: Date | null;
}

export interface CustomerOverview {
  customer: {
    id: string;
    name: string;
    customerNumber: string | null;
    email: string | null;
    type: string;
    isArchived: boolean;
  };
  kpis: CustomerOverviewKpis;
  invoices: InvoiceListRow[];
  quotes: QuoteListRow[];
  deliveryNotes: DeliveryNoteListRow[];
  recurring: RecurringListRow[];
}

export async function customerOverview(orgId: string, customerId: string, now: Date = new Date()): Promise<CustomerOverview> {
  const customer = await dbInternal.customer.findFirst({
    where: { id: customerId, orgId },
    select: { id: true, name: true, customerNumber: true, email: true, type: true, isArchived: true },
  });
  if (!customer) throw new NotFoundError("Kunde nicht gefunden.");

  const [invoiceList, quoteList, deliveryNoteList, recurringList] = await Promise.all([
    listInvoices(orgId, { customerId, limit: 20, sort: "issueDate_desc" }, now),
    listQuotes(orgId, { customerId, limit: 20, includeArchived: true }, now),
    listDeliveryNotes(orgId, { customerId, limit: 20, includeArchived: true }),
    listRecurring(orgId, { customerId, limit: 20 }),
  ]);

  // KPIs: ueber ALLE Rechnungen des Kunden (nicht nur die 20 angezeigten) — eigene,
  // schlanke Aggregations-Query statt listInvoices ohne limit zu missbrauchen.
  const allInvoices = await dbInternal.invoice.findMany({
    where: { orgId, customerId },
    select: {
      status: true,
      dueDate: true,
      issueDate: true,
      grossTotalCents: true,
      netTotalCents: true,
      paidAmountCents: true,
      payableCents: true,
      type: true,
      updatedAt: true,
    },
  });

  let openCents = 0;
  let overdueCents = 0;
  let totalRevenueCents = 0;
  let lastActivityAt: Date | null = null;

  for (const inv of allInvoices) {
    // Fix I3 (Abschluss-Review): "Nettoumsatz" — dieselbe Definition wie die Umsatzreihe/
    // -diagramme (src/domain/reporting/revenue.ts), reuse statt Parallel-Summe (§1.4):
    // `signedRevenueShareCents` (netto, Vorzeichen-normalisiert) statt `payableBaseCents`
    // (brutto), nur `status !== "DRAFT"` statt zusaetzlich `CANCELLED` auszuschliessen —
    // vorher warf der Filter das stornierte Original raus, behielt aber die Storno-
    // Gutschrift (status FINALIZED) mit ihrem negativen Betrag, was die Kachel zu niedrig
    // auswies (Review-Befund, Screenshot 12e-03).
    if (inv.status !== "DRAFT") {
      totalRevenueCents += signedRevenueShareCents(inv);
    }
    if (["FINALIZED", "SENT", "PARTIALLY_PAID"].includes(inv.status)) {
      const status = effectiveInvoiceStatus({ status: inv.status, dueDate: inv.dueDate, issueDate: inv.issueDate }, now);
      const open = openAmountCents(inv);
      if (status === "OVERDUE") overdueCents += open;
      if (status === "OPEN" || status === "DUE" || status === "OVERDUE") openCents += open;
    }
    if (!lastActivityAt || inv.updatedAt.getTime() > lastActivityAt.getTime()) lastActivityAt = inv.updatedAt;
  }

  return {
    customer,
    kpis: { openCents, overdueCents, totalRevenueCents, lastActivityAt },
    invoices: invoiceList.rows,
    quotes: quoteList.rows,
    deliveryNotes: deliveryNoteList.rows,
    recurring: recurringList.rows,
  };
}
