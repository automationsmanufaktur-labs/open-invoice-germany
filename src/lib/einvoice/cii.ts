/**
 * Erzeugt eine CII-Rechnung (UN/CEFACT Cross Industry Invoice) im EN-16931-
 * Profil — das XML, das ZUGFeRD/Factur-X in ein PDF/A-3 einbettet.
 *
 * Validierung: offizielles EN-16931-CII-Schematron (siehe scripts/validate-erechnung.ts).
 * Gutschriften (CREDIT_NOTE) werden mit positiven Beträgen + TypeCode 381 erzeugt.
 */
import { create } from "xmlbuilder2";
import { parseRichText, plainText } from "@/lib/richtext";
import type { EInvoiceData, EInvoiceLine } from "./types";

type XmlNode = ReturnType<typeof create>;

const NS = {
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
};

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}
function quantity(milli: number): string {
  const v = Math.abs(milli) / 1000;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
}
function ciiDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
function typeCode(type: string): string {
  return type === "CREDIT_NOTE" ? "381" : type === "CORRECTION" ? "384" : "380";
}
function exemptionReason(category: string): string | null {
  switch (category) {
    case "AE":
      return "Steuerschuldnerschaft des Leistungsempfängers";
    case "K":
      return "Innergemeinschaftliche Lieferung";
    case "G":
      return "Ausfuhrlieferung";
    case "E":
      return "Steuerbefreit";
    case "Z":
      return "Nullsatz";
    case "O":
      return "Nicht im Inland steuerbar gem. § 3a Abs. 2 UStG";
    default:
      return null;
  }
}

// BR-DE-23: PayeePartyCreditorFinancialAccount nur bei Überweisung/Lastschrift.
const ACCOUNT_REQUIRING_CODES = new Set(["58", "59", "30"]);

/** Phase 4b (§8): nur ITEM-Zeilen gehen ins XML — HEADING/TEXT/SUBTOTAL sind reine
 * PDF-Gliederungszeilen. Fehlt lineType (Alt-Fixtures), wird ITEM angenommen. */
function isItemLine(line: EInvoiceLine): boolean {
  return (line.lineType ?? "ITEM") === "ITEM";
}

/** BG-27/BG-20 — SpecifiedTradeAllowanceCharge (ChargeIndicator false = Rabatt). */
function appendAllowanceCharge(
  parent: XmlNode,
  opts: {
    isCharge: boolean;
    amountCents: number;
    baseCents: number;
    reason: string;
    reasonCode?: string;
    calculationPercent?: number;
    categoryTax?: { categoryCode: string; taxRate: number };
  },
): void {
  const ac = parent.ele("ram:SpecifiedTradeAllowanceCharge");
  ac.ele("ram:ChargeIndicator").ele("udt:Indicator").txt(opts.isCharge ? "true" : "false").up().up();
  if (opts.calculationPercent !== undefined) {
    ac.ele("ram:CalculationPercent").txt((opts.calculationPercent / 10).toFixed(2)).up();
  }
  ac.ele("ram:BasisAmount").txt(money(opts.baseCents)).up();
  ac.ele("ram:ActualAmount").txt(money(opts.amountCents)).up();
  if (opts.reasonCode) ac.ele("ram:ReasonCode").txt(opts.reasonCode).up();
  ac.ele("ram:Reason").txt(opts.reason).up();
  if (opts.categoryTax) {
    const cat = ac.ele("ram:CategoryTradeTax");
    cat.ele("ram:TypeCode").txt("VAT").up();
    cat.ele("ram:CategoryCode").txt(opts.categoryTax.categoryCode).up();
    cat.ele("ram:RateApplicablePercent").txt(String(opts.categoryTax.taxRate)).up();
    cat.up();
  }
  ac.up();
}

function appendAddress(parent: XmlNode, party: EInvoiceData["seller"]) {
  const addr = parent.ele("ram:PostalTradeAddress");
  addr.ele("ram:PostcodeCode").txt(party.postalCode).up();
  addr.ele("ram:LineOne").txt(party.addressLine1).up();
  if (party.addressLine2) addr.ele("ram:LineTwo").txt(party.addressLine2).up();
  addr.ele("ram:CityName").txt(party.city).up();
  addr.ele("ram:CountryID").txt(party.countryCode).up();
  addr.up();
}

export function buildFacturXCII(data: EInvoiceData): string {
  const cur = data.currency;
  const isCredit = data.type === "CREDIT_NOTE";
  const amt = (cents: number) => money(isCredit ? Math.abs(cents) : cents);

  const root = create({ version: "1.0", encoding: "UTF-8" }).ele("rsm:CrossIndustryInvoice", {
    "xmlns:rsm": NS.rsm,
    "xmlns:ram": NS.ram,
    "xmlns:udt": NS.udt,
  });

  // Kontext / Profil
  root
    .ele("rsm:ExchangedDocumentContext")
    .ele("ram:GuidelineSpecifiedDocumentContextParameter")
    .ele("ram:ID")
    .txt("urn:cen.eu:en16931:2017")
    .up()
    .up()
    .up();

  // Kopf
  const doc = root.ele("rsm:ExchangedDocument");
  doc.ele("ram:ID").txt(data.number).up();
  doc.ele("ram:TypeCode").txt(typeCode(data.type)).up();
  doc.ele("ram:IssueDateTime").ele("udt:DateTimeString", { format: "102" }).txt(ciiDate(data.issueDate)).up().up();
  if (data.notes) doc.ele("ram:IncludedNote").ele("ram:Content").txt(data.notes).up().up();
  doc.up();

  const tx = root.ele("rsm:SupplyChainTradeTransaction");

  // Positionen. Phase 4b (§8): nur ITEM-Zeilen; LineID fortlaufend NEU über die
  // gefilterten ITEMs (nicht die gespeicherte Position, die auch HEADING/TEXT/SUBTOTAL zählt).
  const itemLines = data.lines.filter(isItemLine);
  itemLines.forEach((line, i) => {
    const li = tx.ele("ram:IncludedSupplyChainTradeLineItem");
    li.ele("ram:AssociatedDocumentLineDocument").ele("ram:LineID").txt(String(i + 1)).up().up();
    const product = li.ele("ram:SpecifiedTradeProduct");
    // BT-155 — Artikelnummer. XSD-Reihenfolge: SellerAssignedID VOR Name.
    if (line.articleNumber) product.ele("ram:SellerAssignedID").txt(line.articleNumber).up();
    product.ele("ram:Name").txt(line.description).up();
    // BT-154 — Langtext als Klartext (kein Markdown). XSD-Reihenfolge: Description NACH Name.
    if (line.descriptionLong) {
      const text = plainText(parseRichText(line.descriptionLong));
      if (text) product.ele("ram:Description").txt(text).up();
    }
    product.up();
    li
      .ele("ram:SpecifiedLineTradeAgreement")
      .ele("ram:NetPriceProductTradePrice")
      .ele("ram:ChargeAmount")
      .txt(amt(line.unitNetPriceCents))
      .up()
      .up()
      .up();
    li
      .ele("ram:SpecifiedLineTradeDelivery")
      .ele("ram:BilledQuantity", { unitCode: line.unit })
      .txt(quantity(line.quantityMilli))
      .up()
      .up();
    const ls = li.ele("ram:SpecifiedLineTradeSettlement");
    const ltax = ls.ele("ram:ApplicableTradeTax");
    ltax.ele("ram:TypeCode").txt("VAT").up();
    ltax.ele("ram:CategoryCode").txt(line.taxCategory).up();
    ltax.ele("ram:RateApplicablePercent").txt(String(line.taxRate)).up();
    ltax.up();
    // BG-27 — Zeilenrabatt.
    if (line.discountCents) {
      appendAllowanceCharge(ls, {
        isCharge: false,
        amountCents: Math.abs(line.discountCents),
        baseCents: Math.abs(line.grossLineCents ?? line.lineNetCents),
        reason: "Rabatt",
        reasonCode: "95",
        calculationPercent: line.discountPermille,
      });
    }
    ls.ele("ram:SpecifiedTradeSettlementLineMonetarySummation").ele("ram:LineTotalAmount").txt(amt(line.lineNetCents)).up().up();
    ls.up();
    li.up();
  });

  // Parteien (HeaderTradeAgreement)
  const agr = tx.ele("ram:ApplicableHeaderTradeAgreement");
  agr.ele("ram:BuyerReference").txt(data.buyerReference || data.number).up();

  const seller = agr.ele("ram:SellerTradeParty");
  seller.ele("ram:Name").txt(data.seller.name).up();
  appendAddress(seller, data.seller);
  if (data.seller.vatId) {
    seller.ele("ram:SpecifiedTaxRegistration").ele("ram:ID", { schemeID: "VA" }).txt(data.seller.vatId).up().up();
  }
  if (data.seller.taxNumber) {
    seller.ele("ram:SpecifiedTaxRegistration").ele("ram:ID", { schemeID: "FC" }).txt(data.seller.taxNumber).up().up();
  }
  seller.up();

  const buyer = agr.ele("ram:BuyerTradeParty");
  buyer.ele("ram:Name").txt(data.buyer.name).up();
  appendAddress(buyer, data.buyer);
  if (data.buyer.vatId) {
    buyer.ele("ram:SpecifiedTaxRegistration").ele("ram:ID", { schemeID: "VA" }).txt(data.buyer.vatId).up().up();
  }
  buyer.up();

  // BT-13 — Bestellnummer des Kunden (Phase 4b). CII-Reihenfolge: nach BuyerTradeParty,
  // vor SpecifiedTradeSettlement/HeaderTradeDelivery.
  if (data.orderNumber) {
    agr.ele("ram:BuyerOrderReferencedDocument").ele("ram:IssuerAssignedID").txt(data.orderNumber).up().up();
  }
  agr.up();

  // Lieferung
  const del = tx.ele("ram:ApplicableHeaderTradeDelivery");
  if (data.deliveryDate) {
    del
      .ele("ram:ActualDeliverySupplyChainEvent")
      .ele("ram:OccurrenceDateTime")
      .ele("udt:DateTimeString", { format: "102" })
      .txt(ciiDate(data.deliveryDate))
      .up()
      .up()
      .up();
  }
  del.up();

  // Abrechnung
  const set = tx.ele("ram:ApplicableHeaderTradeSettlement");
  set.ele("ram:InvoiceCurrencyCode").txt(cur).up();
  // Zahlungsweg (BT-81 ff.) — Phase 4a: data.paymentMeans, sonst der bisherige
  // reine IBAN-Fallback (byte-identisch zum bisherigen Verhalten).
  if (data.paymentMeans) {
    const pmMeans = data.paymentMeans;
    const pm = set.ele("ram:SpecifiedTradeSettlementPaymentMeans");
    pm.ele("ram:TypeCode").txt(pmMeans.code).up();
    if (pmMeans.iban && ACCOUNT_REQUIRING_CODES.has(pmMeans.code)) {
      pm.ele("ram:PayeePartyCreditorFinancialAccount").ele("ram:IBANID").txt(pmMeans.iban).up().up();
    }
    pm.up();
  } else if (data.iban) {
    const pm = set.ele("ram:SpecifiedTradeSettlementPaymentMeans");
    pm.ele("ram:TypeCode").txt("58").up();
    pm.ele("ram:PayeePartyCreditorFinancialAccount").ele("ram:IBANID").txt(data.iban).up().up();
    pm.up();
  }
  for (const sub of data.taxSubtotals) {
    const t = set.ele("ram:ApplicableTradeTax");
    t.ele("ram:CalculatedAmount").txt(amt(sub.taxCents)).up();
    t.ele("ram:TypeCode").txt("VAT").up();
    const reason = exemptionReason(sub.taxCategory);
    if (reason) t.ele("ram:ExemptionReason").txt(reason).up();
    t.ele("ram:BasisAmount").txt(amt(sub.netCents)).up();
    t.ele("ram:CategoryCode").txt(sub.taxCategory).up();
    t.ele("ram:RateApplicablePercent").txt(String(sub.taxRate)).up();
    t.up();
  }
  // BG-20/BG-21 — Beleg-Rabatt/-Aufschlag je Steuersatz-Gruppe, NACH ApplicableTradeTax
  // und VOR SpecifiedTradePaymentTerms (CII-XSD-Reihenfolge).
  for (const allowance of data.documentAllowances ?? []) {
    appendAllowanceCharge(set, {
      isCharge: false,
      amountCents: allowance.amountCents,
      baseCents: allowance.baseCents,
      reason: allowance.reason,
      reasonCode: "95",
      categoryTax: { categoryCode: allowance.taxCategory, taxRate: allowance.taxRate },
    });
  }
  for (const charge of data.documentCharges ?? []) {
    appendAllowanceCharge(set, {
      isCharge: true,
      amountCents: charge.amountCents,
      baseCents: charge.baseCents,
      reason: charge.reason,
      categoryTax: { categoryCode: charge.taxCategory, taxRate: charge.taxRate },
    });
  }
  // BT-20 — Zahlungsbedingungen (Skonto-Syntax siehe mapper.ts).
  const paymentTermsNote = data.paymentTermsNote ?? data.paymentTerms;
  if (paymentTermsNote) {
    set.ele("ram:SpecifiedTradePaymentTerms").ele("ram:Description").txt(paymentTermsNote).up().up();
  }
  const lineTotal = data.lineTotalCents ?? data.netTotalCents;
  const allowanceTotal = data.allowanceTotalCents ?? 0;
  const chargeTotal = data.chargeTotalCents ?? 0;
  const sum = set.ele("ram:SpecifiedTradeSettlementHeaderMonetarySummation");
  sum.ele("ram:LineTotalAmount").txt(amt(lineTotal)).up();
  // Fix-Runde 1 (Befund A): Gutschrift-Buckets sind vorzeichen-gespiegelt (negativ) —
  // Gate auf !== 0 und Math.abs() statt amt()/isCredit.
  if (allowanceTotal !== 0) sum.ele("ram:AllowanceTotalAmount").txt(money(Math.abs(allowanceTotal))).up();
  if (chargeTotal !== 0) sum.ele("ram:ChargeTotalAmount").txt(money(Math.abs(chargeTotal))).up();
  sum.ele("ram:TaxBasisTotalAmount").txt(amt(data.netTotalCents)).up();
  sum.ele("ram:TaxTotalAmount", { currencyID: cur }).txt(amt(data.taxTotalCents)).up();
  sum.ele("ram:GrandTotalAmount").txt(amt(data.grossTotalCents)).up();
  if (data.paidCents) sum.ele("ram:TotalPrepaidAmount").txt(amt(data.paidCents)).up();
  sum.ele("ram:DuePayableAmount").txt(amt(data.payableCents)).up();
  sum.up();
  set.up();
  tx.up();

  return root.end({ prettyPrint: true });
}
