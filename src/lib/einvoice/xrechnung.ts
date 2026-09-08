/**
 * Erzeugt eine XRechnung (UBL-Syntax) nach EN 16931 + KoSIT-CIUS XRechnung 3.0.
 *
 * Hinweis: Der reine XML-Teil ist bei E-Rechnungen führend (BMF 15.10.2025).
 * Die autoritative Validierung erfolgt im CI gegen den offiziellen
 * KoSIT-Validator; lokal prüft validateEn16931Core() die wichtigsten
 * Geschäftsregeln (siehe en16931-core.ts).
 */
import { create } from "xmlbuilder2";
import { roundHalfUp } from "@/lib/money";
import { parseRichText, plainText } from "@/lib/richtext";
import { deductionsNoteText } from "./deduction-note";
import { exemptionReasonCode, exemptionReasonText } from "./exemption";
import { CONSUMER_RETENTION_HINT } from "@/domain/invoice/mandatory";
import type { EInvoiceData, EInvoiceLine } from "./types";

type XmlNode = ReturnType<typeof create>;

// XRechnung 3.0 CIUS-Kennung (BT-24). Seit XRechnung 3.0 mit neuem Namespace
// urn:xeinkauf.de:kosit (NICHT mehr urn:xoev-de:kosit:standard) — sonst BR-DE-21.
const XRECHNUNG_CUSTOMIZATION =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const PEPPOL_PROFILE = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function quantity(milli: number): string {
  const value = milli / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function isoDate(date: Date): string {
  // Lokale Y/M/D-Komponenten — NICHT toISOString() (würde bei lokaler Mitternacht
  // in UTC um einen Tag zurückspringen und ein falsches Ausstellungs-/Leistungsdatum erzeugen).
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function invoiceTypeCode(type: string): string {
  switch (type) {
    case "CREDIT_NOTE":
      return "381";
    case "CORRECTION":
      return "384";
    // Phase 5 — UNTDID 1001: Abschlagsrechnung (Anzahlungsrechnung). PARTIAL/FINAL
    // bleiben 380 (Teil- bzw. Schlussrechnung sind rechtlich "normale" Rechnungen).
    case "DOWNPAYMENT":
      return "386";
    default:
      return "380";
  }
}

// BR-DE-23: PayeeFinancialAccount nur bei Überweisung/Lastschrift (58 SEPA-Überweisung,
// 59 SEPA-Lastschrift, 30 Überweisung) — NICHT bei Barzahlung (10) o.ä.
const ACCOUNT_REQUIRING_CODES = new Set(["58", "59", "30"]);

/** Phase 4b (§8): nur ITEM-Zeilen gehen ins XML — HEADING/TEXT/SUBTOTAL sind reine
 * PDF-Gliederungszeilen. Fehlt lineType (Alt-Fixtures), wird ITEM angenommen. */
function isItemLine(line: EInvoiceLine): boolean {
  return (line.lineType ?? "ITEM") === "ITEM";
}

/** BG-27/BG-20 — Zeilen- bzw. Beleg-AllowanceCharge (ChargeIndicator false = Rabatt). */
function appendAllowanceCharge(
  parent: XmlNode,
  opts: {
    isCharge: boolean;
    amountCents: number;
    baseCents: number;
    reason: string;
    reasonCode?: string;
    multiplierPermille?: number;
    currency: string;
    taxCategory?: { id: string; taxRate: number };
  },
): void {
  const ac = parent.ele("cac:AllowanceCharge");
  ac.ele("cbc:ChargeIndicator").txt(opts.isCharge ? "true" : "false").up();
  if (opts.reasonCode) ac.ele("cbc:AllowanceChargeReasonCode").txt(opts.reasonCode).up();
  ac.ele("cbc:AllowanceChargeReason").txt(opts.reason).up();
  // XRechnung-CIUS: MultiplierFactorNumeric MUSS vorhanden sein, sobald BaseAmount
  // gesetzt ist — bei rein prozentualem Rabatt der echte Satz, sonst der aus
  // Amount/BaseAmount abgeleitete effektive Satz (Festbetragsrabatt).
  const multiplierPermille =
    opts.multiplierPermille ?? (opts.baseCents !== 0 ? roundHalfUp((opts.amountCents * 1000) / opts.baseCents) : 0);
  ac.ele("cbc:MultiplierFactorNumeric").txt((multiplierPermille / 10).toFixed(2)).up();
  ac.ele("cbc:Amount", { currencyID: opts.currency }).txt(money(opts.amountCents)).up();
  ac.ele("cbc:BaseAmount", { currencyID: opts.currency }).txt(money(opts.baseCents)).up();
  if (opts.taxCategory) {
    const cat = ac.ele("cac:TaxCategory");
    cat.ele("cbc:ID").txt(opts.taxCategory.id).up();
    cat.ele("cbc:Percent").txt(String(opts.taxCategory.taxRate)).up();
    cat.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    cat.up();
  }
  ac.up();
}

function appendParty(parent: XmlNode, party: EInvoiceData["seller"], isSeller: boolean) {
  const p = parent.ele("cac:Party");

  // BT-34 / BT-49 — elektronische Adresse (Endpoint)
  const endpoint = party.electronicAddress ?? party.email ?? null;
  if (endpoint) {
    p.ele("cbc:EndpointID", { schemeID: "EM" }).txt(endpoint).up();
  }

  // BT-29 — Verkäuferkennung (PartyIdentification). Phase 12b: BR-CO-26 verlangt BT-29,
  // BT-30 ODER BT-31 — BT-32 (Steuernummer, s.u.) genügt der Kernregel NICHT (nur BR-DE).
  // Ohne USt-IdNr. (Kleinunternehmer) wird daher die Steuernummer zusätzlich als
  // generische Verkäuferkennung ausgewiesen, damit BR-CO-26 erfüllt ist.
  if (isSeller && !party.vatId && party.taxNumber) {
    p.ele("cac:PartyIdentification").ele("cbc:ID").txt(party.taxNumber).up().up();
  }

  const postal = p.ele("cac:PostalAddress");
  postal.ele("cbc:StreetName").txt(party.addressLine1).up();
  if (party.addressLine2) postal.ele("cbc:AdditionalStreetName").txt(party.addressLine2).up();
  postal.ele("cbc:CityName").txt(party.city).up();
  postal.ele("cbc:PostalZone").txt(party.postalCode).up();
  postal.ele("cac:Country").ele("cbc:IdentificationCode").txt(party.countryCode).up().up();

  // BT-31/BT-48 — USt-IdNr. (PartyTaxScheme VAT)
  if (party.vatId) {
    const pts = p.ele("cac:PartyTaxScheme");
    pts.ele("cbc:CompanyID").txt(party.vatId).up();
    pts.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
  }
  // BT-32 — Steuernummer (PartyTaxScheme FC). M2 (Fix-Welle Final-Review): BT-32 erfüllt
  // BR-CO-26 NICHT (nur BT-29/BT-30/BT-31, s. Kommentar oben) — deshalb der zusätzliche
  // BT-29-Zusatz oben für Kleinunternehmer ohne USt-IdNr. BT-32 bleibt trotzdem als eigene,
  // kanonische Angabe der Steuernummer erhalten (§ 14 Abs. 4 Nr. 2 UStG, unabhängig von BR-CO-26).
  if (isSeller && party.taxNumber) {
    const pts = p.ele("cac:PartyTaxScheme");
    pts.ele("cbc:CompanyID").txt(party.taxNumber).up();
    pts.ele("cac:TaxScheme").ele("cbc:ID").txt("FC").up().up();
  }

  // Registrierter Name (BT-27 / BT-44)
  p.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(party.name).up().up();

  // BG-6 — Kontakt (für Seller von XRechnung verlangt)
  if (isSeller) {
    const contact = p.ele("cac:Contact");
    contact.ele("cbc:Name").txt(party.contactName ?? party.name).up();
    if (party.phone) contact.ele("cbc:Telephone").txt(party.phone).up();
    if (party.email) contact.ele("cbc:ElectronicMail").txt(party.email).up();
    contact.up();
  }

  p.up();
}

export function buildXRechnungUBL(data: EInvoiceData): string {
  const cur = data.currency;
  // Gutschriften (Storno) werden als UBL CreditNote-Dokument mit POSITIVEN Beträgen
  // erzeugt (EN-16931-Konvention); intern sind die Beträge negativ gespeichert.
  const isCredit = data.type === "CREDIT_NOTE";
  const rootName = isCredit ? "CreditNote" : "Invoice";
  const rootNs = isCredit
    ? "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
    : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  const amt = (cents: number) => money(isCredit ? Math.abs(cents) : cents);
  const qty = (milli: number) => quantity(Math.abs(milli));

  const root = create({ version: "1.0", encoding: "UTF-8" }).ele(rootName, {
    xmlns: rootNs,
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  });

  root.ele("cbc:CustomizationID").txt(XRECHNUNG_CUSTOMIZATION).up();
  root.ele("cbc:ProfileID").txt(PEPPOL_PROFILE).up();
  root.ele("cbc:ID").txt(data.number).up();
  root.ele("cbc:IssueDate").txt(isoDate(data.issueDate)).up();
  if (data.dueDate) root.ele("cbc:DueDate").txt(isoDate(data.dueDate)).up();
  root.ele(isCredit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode").txt(invoiceTypeCode(data.type)).up();
  if (data.notes) root.ele("cbc:Note").txt(data.notes).up();
  // BT-22 (Phase 5) — Abzugsaufstellung der Schlussrechnung als ZUSÄTZLICHES Note-Element
  // (mehrere cbc:Note sind laut UBL-XSD zulässig) — ergänzt einen ggf. vorhandenen
  // Freitext-Hinweis, statt ihn zu ersetzen.
  if (data.deductions?.length) root.ele("cbc:Note").txt(deductionsNoteText(data.deductions)).up();
  // § 14 Abs. 4 Nr. 9 / § 14b Abs. 1 Satz 5 UStG — Aufbewahrungshinweis, als ZUSAETZLICHES
  // Note-Element (mehrere cbc:Note sind laut UBL-XSD zulaessig), Phase 12b Task 5.
  if (data.consumerRetentionHint) root.ele("cbc:Note").txt(CONSUMER_RETENTION_HINT).up();
  root.ele("cbc:DocumentCurrencyCode").txt(cur).up();
  // XRechnung: BT-10 Buyer reference Pflicht (Leitweg-ID im B2G); Fallback Belegnummer
  root.ele("cbc:BuyerReference").txt(data.buyerReference || data.number).up();

  // BG-14 (BT-73/BT-74). UBL-Reihenfolge: nach BuyerReference, vor OrderReference.
  if (data.deliveryStart && data.deliveryEnd) {
    const period = root.ele("cac:InvoicePeriod");
    period.ele("cbc:StartDate").txt(isoDate(data.deliveryStart)).up();
    period.ele("cbc:EndDate").txt(isoDate(data.deliveryEnd)).up();
    period.up();
  }

  // BT-13 — Bestellnummer des Kunden (Phase 4b). UBL-Reihenfolge: direkt nach
  // BuyerReference und vor BillingReference (BG-3).
  if (data.orderNumber) {
    root.ele("cac:OrderReference").ele("cbc:ID").txt(data.orderNumber).up().up();
  }

  // BG-3 — Bezug zur Originalrechnung (Gutschrift/Korrektur, § 31 Abs. 5 UStDV) bzw.
  // Phase 5: je abgesetzter Abschlagsrechnung EIN cac:BillingReference (XSD erlaubt
  // Mehrfachvorkommen). precedingInvoices hat Vorrang, wenn gesetzt (nicht leer) — ohne
  // dieses Feld (Alt-/Nicht-FINAL-Belege) bleibt das Einzelverhalten byte-identisch.
  const precedingInvoices = data.precedingInvoices?.length
    ? data.precedingInvoices
    : data.precedingInvoiceNumber
      ? [{ number: data.precedingInvoiceNumber, issueDate: data.precedingInvoiceDate ?? undefined }]
      : [];
  for (const preceding of precedingInvoices) {
    const idr = root.ele("cac:BillingReference").ele("cac:InvoiceDocumentReference");
    idr.ele("cbc:ID").txt(preceding.number).up();
    if (preceding.issueDate) idr.ele("cbc:IssueDate").txt(isoDate(preceding.issueDate)).up();
    idr.up().up();
  }

  appendParty(root.ele("cac:AccountingSupplierParty"), data.seller, true);
  appendParty(root.ele("cac:AccountingCustomerParty"), data.buyer, false);

  // BG-13/BG-15 — MUSS nach den Parteien und vor PaymentMeans stehen (sonst XSD-fatal).
  // DeliveryType-Reihenfolge: ActualDeliveryDate vor DeliveryLocation.
  const deliverToCountry = data.deliverToCountryCode ?? data.buyer.countryCode ?? null;
  if (data.deliveryDate || deliverToCountry) {
    const delivery = root.ele("cac:Delivery");
    if (data.deliveryDate) delivery.ele("cbc:ActualDeliveryDate").txt(isoDate(data.deliveryDate)).up();
    // BT-80 ist die einzige Pflichtangabe der BG-15 nach EN16931-Kernregel BR-57 — die
    // XRechnung-CIUS (KoSIT-Validator) verlangt zusaetzlich BR-DE-10/BR-DE-11 (Ort +
    // PLZ), sobald die Gruppe uebermittelt wird. Ohne eigene Lieferanschrift (Ruling)
    // ergaenzen wir Ort/PLZ aus der Kaeuferadresse — sonst waeren ALLE Belege mit
    // Lieferland KoSIT-invalid, sobald BG-15 (auch nur mit Land) uebermittelt wird.
    if (deliverToCountry) {
      const loc = delivery.ele("cac:DeliveryLocation").ele("cac:Address");
      loc.ele("cbc:CityName").txt(data.buyer.city).up();
      loc.ele("cbc:PostalZone").txt(data.buyer.postalCode).up();
      loc.ele("cac:Country").ele("cbc:IdentificationCode").txt(deliverToCountry).up().up();
      loc.up();
    }
    delivery.up();
  }

  // Zahlungsweg (BT-81 ff.) — Phase 4a: data.paymentMeans (aus Zahlungsmethoden-Snapshot,
  // Fallback Org-Konto/Code 58); ohne paymentMeans (Alt-/Test-Fixtures) der bisherige
  // reine IBAN-Fallback, byte-identisch zum bisherigen Verhalten.
  if (data.paymentMeans) {
    const pmMeans = data.paymentMeans;
    const pm = root.ele("cac:PaymentMeans");
    pm.ele("cbc:PaymentMeansCode").txt(pmMeans.code).up();
    if (pmMeans.iban && ACCOUNT_REQUIRING_CODES.has(pmMeans.code)) {
      const acc = pm.ele("cac:PayeeFinancialAccount");
      acc.ele("cbc:ID").txt(pmMeans.iban).up();
      if (pmMeans.accountName) acc.ele("cbc:Name").txt(pmMeans.accountName).up();
      acc.up();
    }
    pm.up();
  } else if (data.iban) {
    const pm = root.ele("cac:PaymentMeans");
    pm.ele("cbc:PaymentMeansCode").txt("58").up(); // SEPA credit transfer
    const acc = pm.ele("cac:PayeeFinancialAccount");
    acc.ele("cbc:ID").txt(data.iban).up();
    if (data.bankName) acc.ele("cbc:Name").txt(data.bankName).up();
    acc.up();
    pm.up();
  }

  // BT-20 — Zahlungsbedingungen. paymentTermsNote traegt bei Skonto die
  // #SKONTO#-Freitextsyntax (siehe mapper.ts); ohne Skonto identisch zu paymentTerms.
  const paymentTermsNote = data.paymentTermsNote ?? data.paymentTerms;
  if (paymentTermsNote) {
    root.ele("cac:PaymentTerms").ele("cbc:Note").txt(paymentTermsNote).up().up();
  }

  // BG-20/BG-21 — Beleg-Rabatt/-Aufschlag je Steuersatz-Gruppe. Laut UBL-XSD NACH
  // PaymentTerms und VOR TaxTotal.
  for (const allowance of data.documentAllowances ?? []) {
    appendAllowanceCharge(root, {
      isCharge: false,
      amountCents: allowance.amountCents,
      baseCents: allowance.baseCents,
      reason: allowance.reason,
      reasonCode: "95",
      currency: cur,
      taxCategory: { id: allowance.taxCategory, taxRate: allowance.taxRate },
    });
  }
  for (const charge of data.documentCharges ?? []) {
    appendAllowanceCharge(root, {
      isCharge: true,
      amountCents: charge.amountCents,
      baseCents: charge.baseCents,
      reason: charge.reason,
      currency: cur,
      taxCategory: { id: charge.taxCategory, taxRate: charge.taxRate },
    });
  }

  // BG-22/BG-23 — Steuersummen
  const taxTotal = root.ele("cac:TaxTotal");
  taxTotal.ele("cbc:TaxAmount", { currencyID: cur }).txt(amt(data.taxTotalCents)).up();
  for (const sub of data.taxSubtotals) {
    const st = taxTotal.ele("cac:TaxSubtotal");
    st.ele("cbc:TaxableAmount", { currencyID: cur }).txt(amt(sub.netCents)).up();
    st.ele("cbc:TaxAmount", { currencyID: cur }).txt(amt(sub.taxCents)).up();
    const cat = st.ele("cac:TaxCategory");
    cat.ele("cbc:ID").txt(sub.taxCategory).up();
    cat.ele("cbc:Percent").txt(String(sub.taxRate)).up();
    // UBL-XSD (TaxCategoryType): ReasonCode steht VOR Reason.
    const reasonCode = exemptionReasonCode(sub.taxCategory);
    if (reasonCode) cat.ele("cbc:TaxExemptionReasonCode").txt(reasonCode).up();
    const reason = exemptionReasonText(sub.taxCategory);
    if (reason) cat.ele("cbc:TaxExemptionReason").txt(reason).up();
    cat.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    cat.up();
    st.up();
  }
  taxTotal.up();

  // BG-22 — Gesamtsummen. Reihenfolge laut UBL-XSD (LegalMonetaryTotalType):
  // LineExtensionAmount, TaxExclusiveAmount, TaxInclusiveAmount, AllowanceTotalAmount,
  // ChargeTotalAmount, PrepaidAmount, PayableAmount.
  const lineExtensionTotal = data.lineTotalCents ?? data.netTotalCents;
  const allowanceTotal = data.allowanceTotalCents ?? 0;
  const chargeTotal = data.chargeTotalCents ?? 0;
  const mon = root.ele("cac:LegalMonetaryTotal");
  mon.ele("cbc:LineExtensionAmount", { currencyID: cur }).txt(amt(lineExtensionTotal)).up();
  mon.ele("cbc:TaxExclusiveAmount", { currencyID: cur }).txt(amt(data.netTotalCents)).up();
  mon.ele("cbc:TaxInclusiveAmount", { currencyID: cur }).txt(amt(data.grossTotalCents)).up();
  // Fix-Runde 1 (Befund A): Gutschrift-Buckets sind vorzeichen-gespiegelt (negativ) —
  // Gate auf !== 0 und Math.abs() statt amt()/isCredit, damit ein Rabatt/Aufschlag auf
  // einer Gutschrift ebenfalls (positiv) ausgegeben wird.
  if (allowanceTotal !== 0) mon.ele("cbc:AllowanceTotalAmount", { currencyID: cur }).txt(money(Math.abs(allowanceTotal))).up();
  if (chargeTotal !== 0) mon.ele("cbc:ChargeTotalAmount", { currencyID: cur }).txt(money(Math.abs(chargeTotal))).up();
  if (data.paidCents) mon.ele("cbc:PrepaidAmount", { currencyID: cur }).txt(amt(data.paidCents)).up();
  mon.ele("cbc:PayableAmount", { currencyID: cur }).txt(amt(data.payableCents)).up();
  mon.up();

  // BG-25 — Positionen (Invoice- bzw. CreditNote-Zeilen). Phase 4b (§8): nur ITEM-Zeilen;
  // die Zeilen-IDs werden fortlaufend NEU über die gefilterten ITEMs vergeben (nicht die
  // gespeicherte Position, die auch HEADING/TEXT/SUBTOTAL zählt).
  const lineTag = isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const qtyTag = isCredit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const itemLines = data.lines.filter(isItemLine);
  itemLines.forEach((line, index) => {
    const il = root.ele(lineTag);
    il.ele("cbc:ID").txt(String(index + 1)).up();
    il.ele(qtyTag, { unitCode: line.unit }).txt(qty(line.quantityMilli)).up();
    il.ele("cbc:LineExtensionAmount", { currencyID: cur }).txt(amt(line.lineNetCents)).up();

    // BG-27 — Zeilenrabatt. Reihenfolge laut UBL-XSD: ... LineExtensionAmount,
    // (InvoicePeriod/OrderLineReference), AllowanceCharge, Item, Price.
    if (line.discountCents) {
      appendAllowanceCharge(il, {
        isCharge: false,
        amountCents: Math.abs(line.discountCents),
        baseCents: Math.abs(line.grossLineCents ?? line.lineNetCents),
        reason: "Rabatt",
        reasonCode: "95",
        multiplierPermille: line.discountPermille,
        currency: cur,
      });
    }

    const item = il.ele("cac:Item");
    // BT-154 — Langtext als Klartext (kein Markdown), XSD-Reihenfolge: Description VOR Name.
    if (line.descriptionLong) {
      const text = plainText(parseRichText(line.descriptionLong));
      if (text) item.ele("cbc:Description").txt(text).up();
    }
    item.ele("cbc:Name").txt(line.description).up();
    // BT-155 — Artikelnummer. XSD-Reihenfolge: SellersItemIdentification NACH Name.
    if (line.articleNumber) {
      item.ele("cac:SellersItemIdentification").ele("cbc:ID").txt(line.articleNumber).up().up();
    }
    const ctc = item.ele("cac:ClassifiedTaxCategory");
    ctc.ele("cbc:ID").txt(line.taxCategory).up();
    ctc.ele("cbc:Percent").txt(String(line.taxRate)).up();
    ctc.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    ctc.up();
    item.up();

    il.ele("cac:Price").ele("cbc:PriceAmount", { currencyID: cur }).txt(amt(line.unitNetPriceCents)).up().up();
    il.up();
  });

  return root.end({ prettyPrint: true });
}
