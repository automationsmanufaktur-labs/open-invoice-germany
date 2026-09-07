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
import type { EInvoiceData, EInvoiceDocumentAllowanceCharge, EInvoiceLine } from "@/lib/einvoice/types";

const LINE_TYPES = new Set<NonNullable<EInvoiceLine["lineType"]>>(["ITEM", "HEADING", "TEXT", "SUBTOTAL"]);

/** Engt eine rohe DB-lineType-Zeichenkette auf die bekannte Union ein (Fallback ITEM). */
function toLineType(value: string | undefined): NonNullable<EInvoiceLine["lineType"]> {
  return value && LINE_TYPES.has(value as NonNullable<EInvoiceLine["lineType"]>)
    ? (value as NonNullable<EInvoiceLine["lineType"]>)
    : "ITEM";
}

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
  // K1 — Beleg-Rabatt/-Aufschlag (Phase 4a), analog zum Rechnungs-Mapper.
  documentDiscountPermille?: number;
  documentDiscountCents?: number;
  documentChargePermille?: number;
  documentChargeCents?: number;
  documentChargeReason?: string | null;
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
    // Phase 4b — Positionsblöcke (§8) + Langtext/Artikelnummer, nur fürs PDF (Angebote/
    // Auftragsbestätigungen/Proforma erzeugen keine E-Rechnung).
    lineType?: string;
    descriptionLong?: string | null;
    articleNumber?: string | null;
  }>;
}

export function buildDocEInvoiceData(q: DocInput): EInvoiceData {
  // G1 (Fix-Welle): Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL) tragen keinen Betrag und
  // gehen nie in die Steueraufschluesselung ein (§8) — Fehlt lineType (Alt-Fixtures),
  // wird ITEM angenommen (gleiche Regel wie isItemLine in xrechnung.ts).
  const itemLines = q.lines.filter((l) => toLineType(l.lineType) === "ITEM");
  const totals = computeTaxBreakdown(
    itemLines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    {
      discountPermille: q.documentDiscountPermille,
      discountCents: q.documentDiscountCents,
      chargePermille: q.documentChargePermille,
      chargeCents: q.documentChargeCents,
    },
  );
  // K1 — Beleg-Rabatt/-Aufschlag je Steuersatz-Gruppe, analog buildEInvoiceData (mapper.ts).
  const documentAllowances: EInvoiceDocumentAllowanceCharge[] = totals.breakdown
    .filter((b) => b.allowanceCents !== 0)
    .map((b) => ({
      amountCents: Math.abs(b.allowanceCents),
      baseCents: Math.abs(b.baseNetCents),
      taxRate: b.taxRate,
      taxCategory: b.taxCategory,
      reason: "Rabatt",
    }));
  const documentCharges: EInvoiceDocumentAllowanceCharge[] = totals.breakdown
    .filter((b) => b.chargeCents !== 0)
    .map((b) => ({
      amountCents: Math.abs(b.chargeCents),
      baseCents: Math.abs(b.baseNetCents - b.allowanceCents),
      taxRate: b.taxRate,
      taxCategory: b.taxCategory,
      reason: q.documentChargeReason || "Aufschlag",
    }));
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
      lineType: toLineType(l.lineType),
      descriptionLong: l.descriptionLong ?? null,
      articleNumber: l.articleNumber ?? null,
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
    documentAllowances,
    documentCharges,
    lineTotalCents: totals.lineTotalCents,
    allowanceTotalCents: totals.allowanceTotalCents,
    chargeTotalCents: totals.chargeTotalCents,
    headerText,
    footerText,
  };
}
