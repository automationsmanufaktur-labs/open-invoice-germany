/**
 * Rechnungsliste: Filter/Suche/Paginierung (Phase 8b, §40). Reine Query-Funktion
 * auf `prisma` (geschuetzter Client reicht — es wird nur gelesen), org-scoped.
 * Der Status-Filter uebersetzt effectiveInvoiceStatus in ein serverseitiges
 * Prisma-`where`, statt alle Zeilen zu laden und in JS zu filtern (Paginierung
 * muss auf DB-Ebene stimmen).
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma, ciContains } from "@/lib/db";
import { invoiceListFilterSchema, type InvoiceListFilter } from "@/schemas";
import { effectiveInvoiceStatus, isPartiallyPaid, type EffectiveInvoiceStatus } from "@/domain/invoice/status";
import { openAmountCents } from "@/domain/invoice/amounts";
import { utcDateOnlyPlusDays } from "@/lib/date-only";

export interface InvoiceListRow {
  id: string;
  number: string | null;
  type: string;
  customerId: string;
  customerName: string;
  issueDate: Date;
  dueDate: Date | null;
  grossTotalCents: number;
  paidAmountCents: number;
  openCents: number;
  currency: string;
  effectiveStatus: EffectiveInvoiceStatus;
  /** Fix-Runde 1 (Ruling b): true, wenn mindestens ein EmailLog fuer diesen Beleg
   *  existiert — steuert SEND/RESEND in availableActions (Task 1). */
  hasEmailLog: boolean;
  /** Fix-Welle (S1): Rohstatus ist PARTIALLY_PAID — effectiveStatus kann trotzdem
   *  OPEN/DUE/OVERDUE sein (Restbetrag noch faellig/ueberfaellig). Fuer die Anzeige
   *  ("Überfällig · teilbezahlt", StatusBadge). */
  partiallyPaid: boolean;
  /** Fix-Welle (S6): steuert, ob REMINDER/DUNNING ueberhaupt sinnvoll sind (PAUSED/
   *  STOPPED duerfen keine neue Mahnung anbieten) — vorher nicht selektiert, wodurch
   *  availableActions jede Zeile faelschlich als ACTIVE behandelte. */
  dunningState: "ACTIVE" | "PAUSED" | "STOPPED";
  /** Fix-Welle (Nit): Anzahl bereits erstellter Mahnungen — steuert in RowActionsMenu,
   *  ob "Zahlungserinnerung senden" (noch keine Mahnung, Stufe 0) oder "Nächste Mahnung
   *  erstellen" (bereits mindestens eine) angezeigt wird. */
  dunningCount: number;
}

export interface InvoiceListResult {
  rows: InvoiceListRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Uebersetzt den Status-Filter in ein Prisma-`where` auf `status`/`dueDate`. Tagesgrenzen
 * in UTC (S7 — einheitliche Konvention, siehe src/lib/date-only.ts).
 * "open"/"due"/"overdue" gelten fuer FINALIZED/SENT/PARTIALLY_PAID (siehe
 * effectiveInvoiceStatus, S1: eine teilbezahlte Rechnung mit Restbetrag ist weiterhin
 * faellig/ueberfaellig) — dueDate `null` zaehlt dabei zu "open" (kein Zahlungsziel gesetzt).
 */
function statusWhere(status: InvoiceListFilter["status"], now: Date): Prisma.InvoiceWhereInput | undefined {
  if (status === "all") return undefined;
  if (status === "draft") return { status: "DRAFT" };
  if (status === "paid") return { status: "PAID" };
  if (status === "partial") return { status: "PARTIALLY_PAID" };
  if (status === "cancelled") return { status: "CANCELLED" };

  const today = new Date(utcDateOnlyPlusDays(now, 0));
  const tomorrow = new Date(utcDateOnlyPlusDays(now, 1));
  const openOrDue = { status: { in: ["FINALIZED", "SENT", "PARTIALLY_PAID"] } };

  if (status === "overdue") return { ...openOrDue, dueDate: { lt: today } };
  if (status === "due") return { ...openOrDue, dueDate: { gte: today, lt: tomorrow } };
  // open: kein dueDate ODER dueDate ab morgen.
  return { ...openOrDue, OR: [{ dueDate: null }, { dueDate: { gte: tomorrow } }] };
}

function sortOrder(sort: InvoiceListFilter["sort"]): Prisma.InvoiceOrderByWithRelationInput {
  switch (sort) {
    case "issueDate_asc":
      return { issueDate: "asc" };
    case "dueDate_asc":
      return { dueDate: "asc" };
    case "gross_desc":
      return { grossTotalCents: "desc" };
    case "number_desc":
      return { number: "desc" };
    case "issueDate_desc":
    default:
      return { issueDate: "desc" };
  }
}

export async function listInvoices(
  orgId: string,
  rawFilter: unknown,
  now: Date = new Date(),
): Promise<InvoiceListResult> {
  const filter = invoiceListFilterSchema.parse(rawFilter);

  // AND-Array statt flacher Objekt-Merges: der Status-Filter "open" traegt bereits ein
  // eigenes `OR` (dueDate null ODER ab morgen) — ein zweites `OR` fuer `q` wuerde das
  // erste sonst ueberschreiben statt beide zu kombinieren (Prisma erlaubt nur ein `OR`
  // je Objektebene).
  const and: Prisma.InvoiceWhereInput[] = [{ orgId }];

  const statusCond = statusWhere(filter.status, now);
  if (statusCond) and.push(statusCond);
  if (filter.type) and.push({ type: filter.type });
  if (filter.customerId) and.push({ customerId: filter.customerId });
  if (filter.paymentMethodId) and.push({ paymentMethodId: filter.paymentMethodId });
  if (filter.currency) and.push({ currency: filter.currency });
  if (filter.eInvoice === true) and.push({ xmlFormat: { not: null } });
  if (filter.eInvoice === false) and.push({ xmlFormat: null });
  if (filter.number) and.push({ number: ciContains(filter.number) });

  if (filter.from || filter.to) {
    and.push({
      issueDate: {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      },
    });
  }

  if (filter.minCents != null || filter.maxCents != null) {
    and.push({
      grossTotalCents: {
        ...(filter.minCents != null ? { gte: filter.minCents } : {}),
        ...(filter.maxCents != null ? { lte: filter.maxCents } : {}),
      },
    });
  }

  if (filter.q) {
    const q = filter.q;
    and.push({
      OR: [
        { number: ciContains(q) },
        { orderNumber: ciContains(q) },
        { customer: { name: ciContains(q) } },
        { lines: { some: { description: ciContains(q) } } },
      ],
    });
  }

  const where: Prisma.InvoiceWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: sortOrder(filter.sort),
      skip: filter.offset,
      take: filter.limit,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        customerId: true,
        customer: { select: { name: true } },
        issueDate: true,
        dueDate: true,
        grossTotalCents: true,
        paidAmountCents: true,
        payableCents: true,
        currency: true,
        dunningState: true,
        _count: { select: { dunnings: true } },
      },
    }),
  ]);

  // Fix-Runde 1 (Ruling b): EIN zusaetzlicher Query fuer die ganze Seite statt N+1 —
  // EmailLog.docId ist ueber alle Belegtypen hinweg eindeutig (cuid), ein Match auf
  // `docId` reicht (kein zusaetzlicher docType-Filter noetig: CORRECTION/PARTIAL/
  // DOWNPAYMENT/FINAL/INVOICE senden alle unter docType "INVOICE", CREDIT_NOTE unter
  // "CREDIT_NOTE" — die docId allein identifiziert den Beleg bereits eindeutig).
  const ids = rows.map((r) => r.id);
  const emailLogDocIds = new Set(
    ids.length === 0 ? [] : (await prisma.emailLog.findMany({ where: { orgId, docId: { in: ids } }, select: { docId: true } })).map((e) => e.docId),
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      customerId: r.customerId,
      customerName: r.customer.name,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      grossTotalCents: r.grossTotalCents,
      paidAmountCents: r.paidAmountCents,
      openCents: openAmountCents({
        grossTotalCents: r.grossTotalCents,
        paidAmountCents: r.paidAmountCents,
        payableCents: r.payableCents,
      }),
      currency: r.currency,
      effectiveStatus: effectiveInvoiceStatus({ status: r.status, dueDate: r.dueDate, issueDate: r.issueDate }, now),
      hasEmailLog: emailLogDocIds.has(r.id),
      partiallyPaid: isPartiallyPaid(r.status),
      dunningState: r.dunningState as "ACTIVE" | "PAUSED" | "STOPPED",
      dunningCount: r._count.dunnings,
    })),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}

