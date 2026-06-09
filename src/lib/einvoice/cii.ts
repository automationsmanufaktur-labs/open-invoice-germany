/**
 * Erzeugt eine CII-Rechnung (UN/CEFACT Cross Industry Invoice) im EN-16931-
 * Profil — das XML, das ZUGFeRD/Factur-X in ein PDF/A-3 einbettet.
 *
 * Validierung: offizielles EN-16931-CII-Schematron (siehe scripts/validate-erechnung.ts).
 * Gutschriften (CREDIT_NOTE) werden mit positiven Beträgen + TypeCode 381 erzeugt.
 */
import { create } from "xmlbuilder2";
import type { EInvoiceData } from "./types";

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
    default:
      return null;
  }
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

  // Positionen
  data.lines.forEach((line, i) => {
    const li = tx.ele("ram:IncludedSupplyChainTradeLineItem");
    li.ele("ram:AssociatedDocumentLineDocument").ele("ram:LineID").txt(String(i + 1)).up().up();
    li.ele("ram:SpecifiedTradeProduct").ele("ram:Name").txt(line.description).up().up();
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
  if (data.iban) {
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
  if (data.paymentTerms) {
    set.ele("ram:SpecifiedTradePaymentTerms").ele("ram:Description").txt(data.paymentTerms).up().up();
  }
  const sum = set.ele("ram:SpecifiedTradeSettlementHeaderMonetarySummation");
  sum.ele("ram:LineTotalAmount").txt(amt(data.netTotalCents)).up();
  sum.ele("ram:TaxBasisTotalAmount").txt(amt(data.netTotalCents)).up();
  sum.ele("ram:TaxTotalAmount", { currencyID: cur }).txt(amt(data.taxTotalCents)).up();
  sum.ele("ram:GrandTotalAmount").txt(amt(data.grossTotalCents)).up();
  sum.ele("ram:DuePayableAmount").txt(amt(data.payableCents)).up();
  sum.up();
  set.up();
  tx.up();

  return root.end({ prettyPrint: true });
}
