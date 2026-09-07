/** Framework-/DB-freie Eingabe-Struktur für die E-Rechnungs-Erzeugung. */

export interface EInvoiceParty {
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  city: string;
  countryCode: string; // ISO 3166-1 alpha-2
  vatId?: string | null;
  taxNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  electronicAddress?: string | null; // Peppol/Leitweg-Endpoint
}

export interface EInvoiceLine {
  id: string;
  description: string;
  quantityMilli: number;
  unit: string; // UN/ECE Rec 20
  unitNetPriceCents: number;
  lineNetCents: number;
  taxRate: number;
  taxCategory: string; // UNTDID 5305
}

export interface EInvoiceTaxSubtotal {
  taxCategory: string;
  taxRate: number;
  netCents: number;
  taxCents: number;
}

export interface EInvoiceData {
  number: string; // BT-1
  type: string; // INVOICE | CREDIT_NOTE | CORRECTION
  issueDate: Date; // BT-2
  dueDate?: Date | null; // BT-9
  deliveryDate?: Date | null; // BT-72
  currency: string; // BT-5
  buyerReference?: string | null; // BT-10 (Leitweg-ID im B2G)
  paymentTerms?: string | null; // BT-20
  notes?: string | null; // BT-22
  seller: EInvoiceParty;
  buyer: EInvoiceParty;
  lines: EInvoiceLine[];
  taxSubtotals: EInvoiceTaxSubtotal[];
  netTotalCents: number; // BT-106 / BT-109
  taxTotalCents: number; // BT-110
  grossTotalCents: number; // BT-112
  payableCents: number; // BT-115
  paidCents?: number; // BT-113
  iban?: string | null;
  bic?: string | null;
  bankName?: string | null;
  // BG-3 Vorausgehende Rechnung (für Gutschrift/Korrektur, BT-25/BT-26)
  precedingInvoiceNumber?: string | null;
  precedingInvoiceDate?: Date | null;
  // Kopf-/Fusstext (Platzhalter bereits aufgeloest) — NUR fuer PDF-Layout, Ruling:
  // gehen NICHT ins XRechnung-/ZUGFeRD-XML.
  headerText?: string | null;
  footerText?: string | null;
}
