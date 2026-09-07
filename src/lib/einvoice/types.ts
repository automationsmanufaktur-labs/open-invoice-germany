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
  // BG-27 — Positionsrabatt (Phase 4a). Optional: fehlt bei Belegen ohne Rabatt
  // (Alt-Belege, handgeschriebene Test-Fixtures) — Builder erzeugen dann KEIN
  // Zeilen-AllowanceCharge, byte-identisch zum bisherigen Verhalten.
  /** Menge * unitNetPriceCents (unrabattiert) — BaseAmount des Zeilenrabatts. */
  grossLineCents?: number;
  /** Gesamtrabatt der Zeile in Cent (Prozent- + Festbetragsanteil), 0 = kein Rabatt. */
  discountCents?: number;
  /** Prozentualer Anteil des Rabatts in Promille — nur gesetzt, wenn der Rabatt
   * REIN prozentual ist (kein zusätzlicher Festbetrag), für MultiplierFactorNumeric. */
  discountPermille?: number;
  /** Phase 4b — Zeilentyp (§8, "kein Menge-0-Workaround"). Fehlt das Feld (Alt-Fixtures/
   * Tests vor Phase 4b), wird ITEM angenommen. Nur ITEM-Zeilen gehen ins XML (BG-25) und
   * tragen Beträge; HEADING/TEXT/SUBTOTAL sind reine PDF-Gliederungszeilen. */
  lineType?: "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL";
  /** Phase 4b — Rich-Text-Langbeschreibung (Markdown-Teilmenge, siehe src/lib/richtext).
   * BT-154 im XML: NUR bei ITEM-Zeilen, als Klartext (plainText(parseRichText(...))) durch
   * die XML-Builder erzeugt. Das PDF rendert die Markdown-Formatierung direkt. Bei TEXT-
   * Zeilen trägt dieses Feld den Absatztext (Fallback: description). */
  descriptionLong?: string | null;
  /** Phase 4b — Artikelnummer-Snapshot zum Erfassungszeitpunkt. BT-155 im XML (nur ITEM). */
  articleNumber?: string | null;
}

export interface EInvoiceTaxSubtotal {
  taxCategory: string;
  taxRate: number;
  /** Netto NACH Belegrabatt/-aufschlag — Bemessungsgrundlage der Steuer. */
  netCents: number;
  taxCents: number;
  /** Netto VOR Belegrabatt/-aufschlag. Optional (Alt-Belege ohne Beleganpassung: = netCents). */
  baseNetCents?: number;
  /** Anteiliger Belegrabatt dieser Gruppe. */
  allowanceCents?: number;
  /** Anteiliger Belegaufschlag dieser Gruppe. */
  chargeCents?: number;
}

/** BG-20/BG-21 — Beleg-Rabatt bzw. -Aufschlag je Steuersatz-Gruppe (Phase 4a). */
export interface EInvoiceDocumentAllowanceCharge {
  amountCents: number;
  baseCents: number;
  taxRate: number;
  taxCategory: string;
  reason: string;
}

/** BT-81/BT-84 ff. — Zahlungsweg, aus dem Zahlungsmethoden-Snapshot (Phase 4a). */
export interface EInvoicePaymentMeans {
  /** UNTDID 4461 (z. B. "58" SEPA-Überweisung, "10" Barzahlung). */
  code: string;
  iban?: string | null;
  bic?: string | null;
  accountName?: string | null;
}

export interface EInvoiceData {
  number: string; // BT-1
  type: string; // INVOICE | CREDIT_NOTE | CORRECTION
  issueDate: Date; // BT-2
  dueDate?: Date | null; // BT-9
  deliveryDate?: Date | null; // BT-72
  currency: string; // BT-5
  buyerReference?: string | null; // BT-10 (Leitweg-ID im B2G)
  /** Phase 4b — Bestellnummer des Kunden (BT-13, cac:OrderReference/cbc:ID bzw.
   * ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID). Nicht mit buyerReference (BT-10)
   * zu verwechseln. */
  orderNumber?: string | null;
  paymentTerms?: string | null; // BT-20 (Menschentext, z. B. aus Zahlungsmethode/Freitext)
  /** BT-20 XML-Fassung inkl. Skonto-Syntax (#SKONTO#...#) — Mapper-Ausgabe von
   * xrechnungSkontoNote(). Fehlt dieses Feld, nutzen die Builder `paymentTerms`. */
  paymentTermsNote?: string | null;
  /** Fix-Runde 1 (Befund C): Klartext OHNE #SKONTO#-Tags — invoice.paymentTerms bzw.
   * (wenn leer) paymentTermsText(skontoTerms). NUR fuers PDF, nicht ins XML. */
  paymentTermsHuman?: string | null;
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
  // BG-20/BG-21 — Beleg-Rabatt/-Aufschlag (Phase 4a), je Steuersatz-Gruppe.
  documentAllowances?: EInvoiceDocumentAllowanceCharge[];
  documentCharges?: EInvoiceDocumentAllowanceCharge[];
  /** Σ Positionsnetti (nach Zeilenrabatt, vor Beleganpassung) — BT-106-Vorstufe. */
  lineTotalCents?: number;
  /** Σ Belegrabatt über alle Gruppen. */
  allowanceTotalCents?: number;
  /** Σ Belegaufschlag über alle Gruppen. */
  chargeTotalCents?: number;
  /** BT-81 ff. — Zahlungsweg aus dem Zahlungsmethoden-Snapshot (Fallback: Org-Konto, Code 58). */
  paymentMeans?: EInvoicePaymentMeans | null;
  /** Freitext der Zahlungsmethode (invoiceText) — NUR PDF-Layout, nicht im XML. */
  paymentMethodText?: string | null;
  // BG-3 Vorausgehende Rechnung (für Gutschrift/Korrektur, BT-25/BT-26)
  precedingInvoiceNumber?: string | null;
  precedingInvoiceDate?: Date | null;
  // Kopf-/Fusstext (Platzhalter bereits aufgeloest) — NUR fuer PDF-Layout, Ruling:
  // gehen NICHT ins XRechnung-/ZUGFeRD-XML.
  headerText?: string | null;
  footerText?: string | null;
}
