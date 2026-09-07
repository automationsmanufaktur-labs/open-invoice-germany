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

export const PREVIEW_DOC_TYPES = ["INVOICE", "ANGEBOT", "DELIVERY_NOTE"] as const;
export type PreviewDocType = (typeof PREVIEW_DOC_TYPES)[number];

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

/** Baut Musterdaten für Rechnung/Angebot (renderInvoicePdf) — echte Org-Stammdaten, feste Beispielpositionen. */
export function buildSampleInvoiceData(org: PreviewOrg, docType: "INVOICE" | "ANGEBOT"): EInvoiceData {
  const data = buildDocEInvoiceData({
    number: docType === "INVOICE" ? "MUSTER-2026-00001" : "AN-2026-00001",
    kind: docType,
    issueDate: SAMPLE_DATE,
    validUntil: docType === "ANGEBOT" ? new Date(SAMPLE_DATE.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
    currency: "EUR",
    notes: "Dies ist eine Musterrechnung zur Vorschau von Briefpapier und Druckoptionen — kein echter Beleg.",
    org,
    customer: SAMPLE_CUSTOMER,
    lines: SAMPLE_LINES,
  });
  // buildDocEInvoiceData setzt type=kind ("ANGEBOT" o. ae.) — fuer eine INVOICE-Vorschau
  // (GiroCode-Gate prueft data.type ∈ {INVOICE, PARTIAL, ...}) muss der Typ INVOICE sein.
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
