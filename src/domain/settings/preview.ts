/**
 * Musterdaten fuer die Briefpapier-/Druckoptionen-Vorschau (Phase 7, Task 4, §35/§36).
 * Kein DB-Beleg — feste Beispielpositionen, aber ECHTE Absender-Stammdaten (Organization).
 * Wiederverwendet buildDocEInvoiceData (src/domain/document/pdf-data.ts), damit dieselbe
 * Rechnungs-/Angebots-Rendering-Logik (Positionstabelle, Summenblock, GiroCode) wie bei
 * einem echten Beleg greift — kein separater, ggf. abweichender Vorschau-Renderer.
 */
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import type { EInvoiceData } from "@/lib/einvoice/types";
import type { DeliveryNotePdfData } from "@/lib/pdf/delivery-note-pdf";
import type { DunningPdfData } from "@/lib/pdf/dunning-pdf";
import type { LayoutDocType } from "@/lib/pdf/layouts/ids";

// Phase 11b, Task 6: um CREDIT_NOTE (Gutschrift) und DUNNING (Mahnung) erweitert, damit
// die Layout-Vorschau (Task 5/6) auch fuer diese beiden Belegtypen ein Muster-PDF liefern
// kann — dieselben fuenf Typen wie in `resolveLayoutId`/`LayoutDocType`, nur ohne
// ORDER_CONFIRMATION/PROFORMA (dafuer gibt es keinen eigenen Muster-Renderer, sie teilen
// sich mit ANGEBOT denselben Rechnungs-Renderer und werden ueber die Typ-Map ohnehin nicht
// separat vorgeschaut).
export const PREVIEW_DOC_TYPES = ["INVOICE", "CREDIT_NOTE", "ANGEBOT", "DELIVERY_NOTE", "DUNNING"] as const;
export type PreviewDocType = (typeof PREVIEW_DOC_TYPES)[number];

/** Bildet den Vorschau-Belegtyp auf den `LayoutDocType` ab, den `loadPdfTheme`/
 *  `resolveLayoutId` erwarten (Phase 11b, Task 6) — 1:1 bis auf ANGEBOT -> QUOTE. */
export const PREVIEW_DOC_TYPE_TO_LAYOUT_DOC_TYPE: Record<PreviewDocType, LayoutDocType> = {
  INVOICE: "INVOICE",
  CREDIT_NOTE: "CREDIT_NOTE",
  ANGEBOT: "QUOTE",
  DELIVERY_NOTE: "DELIVERY_NOTE",
  DUNNING: "DUNNING",
};

interface PreviewOrg {
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
}

const SAMPLE_CUSTOMER = {
  name: "Musterkunde GmbH",
  contactName: "Max Mustermann",
  addressLine1: "Beispielstraße 42",
  addressLine2: null,
  postalCode: "12345",
  city: "Musterstadt",
  countryCode: "DE",
  vatId: "DE999999999",
  email: "buchhaltung@musterkunde.example",
  leitwegId: null,
};

const SAMPLE_LINES = [
  { description: "Beratungsleistung", quantityMilli: 5000, unit: "HUR", unitNetPriceCents: 9500, lineNetCents: 475000, taxRate: 19, taxCategory: "S" },
  { description: "Lizenzgebühr (Jahresnutzung)", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 24000, lineNetCents: 24000, taxRate: 19, taxCategory: "S" },
  { description: "Versandkosten", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 1500, lineNetCents: 1500, taxRate: 19, taxCategory: "S" },
];

const SAMPLE_DATE = new Date();

const SAMPLE_NUMBER: Record<"INVOICE" | "ANGEBOT" | "CREDIT_NOTE", string> = {
  INVOICE: "MUSTER-2026-00001",
  ANGEBOT: "AN-2026-00001",
  CREDIT_NOTE: "GS-2026-00001",
};

/** Baut Musterdaten für Rechnung/Gutschrift/Angebot (renderInvoicePdf) — echte
 *  Org-Stammdaten, feste Beispielpositionen. Phase 11b, Task 6: bei CREDIT_NOTE spiegeln
 *  sich die Positionsbeträge (negativ), analog der Storno-Gutschrift in `cancel.ts`
 *  (Bestandskonvention — nur unitNetPriceCents/lineNetCents, nicht die Menge). */
export function buildSampleInvoiceData(org: PreviewOrg, docType: "INVOICE" | "ANGEBOT" | "CREDIT_NOTE"): EInvoiceData {
  const isCreditNote = docType === "CREDIT_NOTE";
  const lines = isCreditNote ? SAMPLE_LINES.map((l) => ({ ...l, unitNetPriceCents: -l.unitNetPriceCents, lineNetCents: -l.lineNetCents })) : SAMPLE_LINES;
  const data = buildDocEInvoiceData({
    number: SAMPLE_NUMBER[docType],
    kind: docType,
    issueDate: SAMPLE_DATE,
    validUntil: docType === "ANGEBOT" ? new Date(SAMPLE_DATE.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
    currency: "EUR",
    notes: isCreditNote
      ? "Dies ist eine Muster-Gutschrift zur Vorschau von Briefpapier und Druckoptionen — kein echter Beleg."
      : "Dies ist eine Musterrechnung zur Vorschau von Briefpapier und Druckoptionen — kein echter Beleg.",
    org,
    customer: SAMPLE_CUSTOMER,
    lines,
  });
  // buildDocEInvoiceData setzt type=kind ("ANGEBOT"/"CREDIT_NOTE" o. ae.) — fuer eine
  // INVOICE-Vorschau (GiroCode-Gate prueft data.type ∈ {INVOICE, PARTIAL, ...}) muss der
  // Typ INVOICE sein; ANGEBOT/CREDIT_NOTE bleiben unveraendert.
  data.type = docType === "INVOICE" ? "INVOICE" : docType;
  if (docType === "INVOICE") {
    data.dueDate = new Date(SAMPLE_DATE.getTime() + 14 * 24 * 60 * 60 * 1000);
    data.paymentTermsHuman = "Zahlbar innerhalb 14 Tagen ohne Abzug.";
    data.giroAmountCents = data.payableCents;
  }
  return data;
}

/** Baut Musterdaten für einen Lieferschein (renderDeliveryNotePdf) — echte Org-Stammdaten als Absender. */
export function buildSampleDeliveryNoteData(org: PreviewOrg): DeliveryNotePdfData {
  return {
    number: "LS-2026-00001",
    issueDate: SAMPLE_DATE,
    deliveryDate: SAMPLE_DATE,
    shippingDate: SAMPLE_DATE,
    currency: "EUR",
    seller: {
      name: org.legalName,
      addressLine1: org.addressLine1,
      postalCode: org.postalCode,
      city: org.city,
      taxNumber: org.taxNumber,
      vatId: org.vatId,
      iban: org.iban,
      bic: org.bic,
      bankName: org.bankName,
    },
    buyer: {
      name: SAMPLE_CUSTOMER.name,
      contactName: SAMPLE_CUSTOMER.contactName,
      addressLine1: SAMPLE_CUSTOMER.addressLine1,
      addressLine2: SAMPLE_CUSTOMER.addressLine2,
      postalCode: SAMPLE_CUSTOMER.postalCode,
      city: SAMPLE_CUSTOMER.city,
    },
    lines: [
      { pos: 1, description: "Beispielartikel A", quantityMilli: 5000, unit: "C62", unitNetPriceCents: 1200, taxRate: 19, articleNumber: "ART-00001" },
      { pos: 2, description: "Beispielartikel B", quantityMilli: 2000, unit: "C62", unitNetPriceCents: 3400, taxRate: 19, articleNumber: "ART-00002" },
    ],
    showPrices: true,
    showTax: true,
    showArticleNumber: true,
    showDescription: true,
    showDeliveryAddress: true,
    headerText: null,
    footerText: null,
    sourceNumber: null,
  };
}

/**
 * Baut Musterdaten für eine Mahnung (renderDunningPdf, Phase 11b, Task 6) — echte
 * Org-Stammdaten als Absender, feste Beispielwerte: Stufe 1, offener Betrag 119,00 €,
 * Verzugszinsen 1,23 €, Verzugspauschale 40,00 € (§288 Abs. 5 BGB), keine Mahnkosten der
 * Stufe (feeCents nur ab Stufe 2, siehe DunningPdfData-Kommentar).
 */
export function buildSampleDunningData(org: PreviewOrg): DunningPdfData {
  const openAmountCents = 11900;
  const interestCents = 123;
  const flatFee40Cents = 4000;
  const feeCents = 0;
  const lateFeeCents = 0;
  return {
    number: "MA-2026-00001",
    level: 1,
    stageName: null,
    sentDate: SAMPLE_DATE,
    newDueDate: new Date(SAMPLE_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
    currency: "EUR",
    seller: {
      name: org.legalName,
      addressLine1: org.addressLine1,
      postalCode: org.postalCode,
      city: org.city,
      taxNumber: org.taxNumber,
      vatId: org.vatId,
      iban: org.iban,
      bic: org.bic,
      bankName: org.bankName,
    },
    buyer: {
      name: SAMPLE_CUSTOMER.name,
      contactName: SAMPLE_CUSTOMER.contactName,
      addressLine1: SAMPLE_CUSTOMER.addressLine1,
      addressLine2: SAMPLE_CUSTOMER.addressLine2,
      postalCode: SAMPLE_CUSTOMER.postalCode,
      city: SAMPLE_CUSTOMER.city,
    },
    invoiceNumber: "MUSTER-2026-00001",
    invoiceDate: new Date(SAMPLE_DATE.getTime() - 45 * 24 * 60 * 60 * 1000),
    openAmountCents,
    interestCents,
    flatFee40Cents,
    feeCents,
    lateFeeCents,
    totalCents: openAmountCents + interestCents + flatFee40Cents + feeCents + lateFeeCents,
    daysOverdue: 14,
  };
}
