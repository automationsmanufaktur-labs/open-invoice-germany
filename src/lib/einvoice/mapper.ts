/**
 * Bildet eine festgeschriebene Rechnung (Prisma) auf die framework-freie
 * EInvoiceData-Struktur ab — gemeinsame Quelle für XRechnung- und PDF-Export.
 */
import { parseSellerSnapshot, parseBuyerSnapshot } from "@/domain/snapshot";
import type { EInvoiceData, EInvoiceTaxSubtotal } from "./types";

export interface MapInput {
  number: string | null;
  type: string;
  issueDate: Date;
  dueDate: Date | null;
  deliveryDate: Date | null;
  currency: string;
  buyerReference: string | null;
  paymentTerms: string | null;
  notes: string | null;
  netTotalCents: number;
  taxTotalCents: number;
  grossTotalCents: number;
  paidAmountCents: number;
  taxBreakdownJson: string;
  // Phase 0: Snapshot der Parteien; bei Entwuerfen null -> Live-Relation.
  sellerSnapshotJson?: string | null;
  buyerSnapshotJson?: string | null;
  id?: string;
  org: {
    legalName: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    city: string;
    country: string;
    vatId: string | null;
    taxNumber: string | null;
    email: string | null;
    phone: string | null;
    electronicAddress: string | null;
    iban: string | null;
    bic: string | null;
    bankName: string | null;
  };
  customer: {
    name: string;
    contactName: string | null;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
    email: string | null;
    leitwegId: string | null;
  };
  lines: Array<{
    id: string;
    description: string;
    quantityMilli: number;
    unit: string;
    unitNetPriceCents: number;
    lineNetCents: number;
    taxRate: number;
    taxCategory: string;
  }>;
}

export function buildEInvoiceData(invoice: MapInput): EInvoiceData {
  const breakdown = JSON.parse(invoice.taxBreakdownJson) as EInvoiceTaxSubtotal[];
  const ctx = invoice.id ?? invoice.number ?? "unbekannt";
  const org = parseSellerSnapshot(invoice.sellerSnapshotJson, invoice.org, ctx);
  const customer = parseBuyerSnapshot(invoice.buyerSnapshotJson, invoice.customer, ctx);

  return {
    number: invoice.number ?? "ENTWURF",
    type: invoice.type,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    deliveryDate: invoice.deliveryDate,
    currency: invoice.currency,
    // B2G: Leitweg-ID des Kunden als Buyer reference (BT-10), sonst explizit gesetzter Wert.
    buyerReference: invoice.buyerReference ?? customer.leitwegId,
    paymentTerms: invoice.paymentTerms,
    notes: invoice.notes,
    seller: {
      name: org.legalName,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      postalCode: org.postalCode,
      city: org.city,
      countryCode: org.country,
      vatId: org.vatId,
      taxNumber: org.taxNumber,
      email: org.email,
      phone: org.phone,
      contactName: null,
      electronicAddress: org.electronicAddress,
    },
    buyer: {
      name: customer.name,
      contactName: customer.contactName,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      postalCode: customer.postalCode,
      city: customer.city,
      countryCode: customer.countryCode,
      vatId: customer.vatId,
      email: customer.email,
    },
    lines: invoice.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitNetPriceCents: l.unitNetPriceCents,
      lineNetCents: l.lineNetCents,
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
    })),
    taxSubtotals: breakdown,
    netTotalCents: invoice.netTotalCents,
    taxTotalCents: invoice.taxTotalCents,
    grossTotalCents: invoice.grossTotalCents,
    payableCents: invoice.grossTotalCents - invoice.paidAmountCents,
    paidCents: invoice.paidAmountCents,
    iban: org.iban,
    bic: org.bic,
    bankName: org.bankName,
  };
}
