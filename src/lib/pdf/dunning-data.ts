/**
 * Baut die Eingabedaten fuer das Mahnungs-PDF aus den DB-Entitaeten. Herausgezogen aus
 * der PDF-Route, damit dieselbe Logik auch beim Mailversand (Standardanhaenge) genutzt
 * werden kann. Verhalten unveraendert — Snapshot-Fallback fuer Mahnungen ist Backlog
 * Phase 6, hier nicht angefasst.
 */
import type { Prisma } from "@/generated/prisma/client";
import { daysBetween } from "@/lib/dunning";
import type { DunningPdfData } from "./dunning-pdf";

export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: { org: true; customer: true } }>;
export type DunningRow = Prisma.DunningGetPayload<{ include: { invoice: { include: { org: true; customer: true } } } }>;

export function buildDunningPdfData(d: DunningRow, inv: InvoiceRow): DunningPdfData {
  const open = inv.grossTotalCents - inv.paidAmountCents;
  const dueDate = inv.dueDate ?? inv.issueDate;

  return {
    number: d.number ?? "",
    level: d.level,
    sentDate: d.sentAt,
    newDueDate: d.dueDate ?? d.sentAt,
    currency: inv.currency,
    seller: {
      name: inv.org.legalName,
      addressLine1: inv.org.addressLine1,
      postalCode: inv.org.postalCode,
      city: inv.org.city,
      taxNumber: inv.org.taxNumber,
      vatId: inv.org.vatId,
      iban: inv.org.iban,
      bic: inv.org.bic,
      bankName: inv.org.bankName,
    },
    buyer: {
      name: inv.customer.name,
      contactName: inv.customer.contactName,
      addressLine1: inv.customer.addressLine1,
      addressLine2: inv.customer.addressLine2,
      postalCode: inv.customer.postalCode,
      city: inv.customer.city,
    },
    invoiceNumber: inv.number ?? "",
    invoiceDate: inv.issueDate,
    openAmountCents: open,
    interestCents: d.interestAmountCents,
    flatFee40Cents: d.flatFee40Cents,
    lateFeeCents: d.lateFeeCents,
    totalCents: open + d.interestAmountCents + d.flatFee40Cents + d.lateFeeCents,
    daysOverdue: daysBetween(dueDate, d.sentAt),
  };
}
