/**
 * Bildet ein Geschäftsdokument (Quote) auf die EInvoiceData-Struktur ab, damit
 * der PDF-Renderer wiederverwendet werden kann. Bei Proforma wird der gesetzlich
 * gebotene Hinweis ergänzt.
 */
import { computeTaxBreakdown } from "@/lib/tax";
import { parseSellerSnapshot, parseBuyerSnapshot } from "@/domain/snapshot";
import { buildDocumentTextContext } from "@/domain/email/context";
import { renderTemplate } from "@/lib/template/render";
import type { EmailDocType } from "@/schemas/email";
import type { EInvoiceData } from "@/lib/einvoice/types";

const PROFORMA_NOTE = "Proforma-Rechnung — keine Rechnung im Sinne des § 14 UStG. Berechtigt nicht zum Vorsteuerabzug.";

interface DocInput {
  number: string | null;
  kind: string;
  issueDate: Date;
  validUntil?: Date | null;
  currency: string;
  notes: string | null;
  headerText?: string | null;
  footerText?: string | null;
  id?: string;
  sellerSnapshotJson?: string | null;
  buyerSnapshotJson?: string | null;
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
    description: string;
    quantityMilli: number;
    unit: string;
    unitNetPriceCents: number;
    lineNetCents: number;
    taxRate: number;
    taxCategory: string;
  }>;
}

export function buildDocEInvoiceData(q: DocInput): EInvoiceData {
  const totals = computeTaxBreakdown(
    q.lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
  );
  const notes = q.kind === "PROFORMA" ? `${PROFORMA_NOTE}${q.notes ? " " + q.notes : ""}` : q.notes;
  const ctx = q.id ?? q.number ?? "unbekannt";
  const org = parseSellerSnapshot(q.sellerSnapshotJson, q.org, ctx);
  const customer = parseBuyerSnapshot(q.buyerSnapshotJson, q.customer, ctx);

  // Kopf-/Fusstext: siehe buildEInvoiceData (mapper.ts) — gleiches Vorgehen, gleiches
  // Ruling (nicht ins XML, da Geschaeftsdokumente ohnehin keine E-Rechnung sind, aber
  // konsistent zur Rechnung gehalten).
  const emailDocType = q.kind as EmailDocType; // ANGEBOT | AUFTRAGSBESTAETIGUNG | PROFORMA
  const textCtx = buildDocumentTextContext({
    docType: emailDocType,
    number: q.number,
    issueDate: q.issueDate,
    validUntil: q.validUntil ?? null,
    totals: { netCents: totals.netTotalCents, taxCents: totals.taxTotalCents, grossCents: totals.grossTotalCents },
    currency: q.currency,
    seller: org,
    buyer: customer,
  });
  const headerText = q.headerText ? renderTemplate(q.headerText, textCtx).text : null;
  const footerText = q.footerText ? renderTemplate(q.footerText, textCtx).text : null;

  return {
    number: q.number ?? "ENTWURF",
    type: q.kind,
    issueDate: q.issueDate,
    dueDate: null,
    deliveryDate: null,
    currency: q.currency,
    buyerReference: null,
    paymentTerms: null,
    notes,
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
    lines: q.lines.map((l, i) => ({
      id: String(i + 1),
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitNetPriceCents: l.unitNetPriceCents,
      lineNetCents: l.lineNetCents,
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
    })),
    taxSubtotals: totals.breakdown,
    netTotalCents: totals.netTotalCents,
    taxTotalCents: totals.taxTotalCents,
    grossTotalCents: totals.grossTotalCents,
    payableCents: totals.grossTotalCents,
    paidCents: 0,
    iban: org.iban,
    bic: org.bic,
    bankName: org.bankName,
    headerText,
    footerText,
  };
}
