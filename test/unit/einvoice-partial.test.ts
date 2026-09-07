/**
 * Phase 5 (§13-15 UStG) — Task 3: PDF und E-Rechnung für Teil-/Abschlags-/
 * Schlussrechnungen. Testjahr 2040.
 *
 * Deckt: InvoiceTypeCode 386 (DOWNPAYMENT) / 380 (PARTIAL/FINAL), BT-113
 * (PrepaidAmount = Σ Abschläge brutto), BT-115 (PayableAmount, BR-CO-16), BG-3
 * mehrfach (je Abschlag), BT-22 (Abzugsaufstellung), PDF-Titel/-Bezug/-Abzugsblock.
 */
import { describe, it, expect } from "vitest";
import { buildEInvoiceData, type MapInput } from "@/lib/einvoice/mapper";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { buildFacturXCII } from "@/lib/einvoice/cii";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { testPdfTheme } from "../helpers/pdf-theme";

const ORG: MapInput["org"] = {
  legalName: "Test GmbH",
  addressLine1: "Hauptstr. 1",
  addressLine2: null,
  postalCode: "21339",
  city: "Lüneburg",
  country: "DE",
  vatId: "DE123456789",
  taxNumber: null,
  email: "info@test.de",
  phone: null,
  electronicAddress: null,
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  bankName: "Test Bank",
};
const CUSTOMER: MapInput["customer"] = {
  name: "Kunde AG",
  contactName: null,
  addressLine1: "Marktplatz 2",
  addressLine2: null,
  postalCode: "20095",
  city: "Hamburg",
  countryCode: "DE",
  vatId: "DE987654321",
  email: "einkauf@kunde.de",
  leitwegId: null,
};

function baseInput(overrides: Partial<MapInput> = {}): MapInput {
  return {
    number: overrides.number ?? "RE-2040-0001",
    type: overrides.type ?? "INVOICE",
    issueDate: overrides.issueDate ?? new Date("2040-04-01"),
    dueDate: overrides.dueDate ?? new Date("2040-04-15"),
    deliveryDate: overrides.deliveryDate ?? new Date("2040-04-01"),
    currency: "EUR",
    buyerReference: "04011000-12345-86",
    paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    notes: "Vielen Dank für Ihren Auftrag.",
    netTotalCents: overrides.netTotalCents ?? 1_000_000,
    taxTotalCents: overrides.taxTotalCents ?? 190_000,
    grossTotalCents: overrides.grossTotalCents ?? 1_190_000,
    paidAmountCents: overrides.paidAmountCents ?? 0,
    taxBreakdownJson:
      overrides.taxBreakdownJson ?? JSON.stringify([{ taxCategory: "S", taxRate: 19, netCents: 1_000_000, taxCents: 190_000 }]),
    prepaidCents: overrides.prepaidCents,
    deductions: overrides.deductions,
    sourceNumber: overrides.sourceNumber ?? null,
    sourceLabel: overrides.sourceLabel ?? null,
    org: ORG,
    customer: CUSTOMER,
    lines: overrides.lines ?? [
      { id: "1", description: "Beratung vor Ort (Gesamtleistung)", quantityMilli: 100_000, unit: "HUR", unitNetPriceCents: 10_000, lineNetCents: 1_000_000, taxRate: 19, taxCategory: "S" },
    ],
  };
}

describe("buildEInvoiceData — Phase 5 InvoiceTypeCode/PrepaidAmount", () => {
  it("DOWNPAYMENT: InvoiceTypeCode 386 (UBL) / TypeCode 386 (CII)", () => {
    const data = buildEInvoiceData(
      baseInput({
        number: "AR-2040-0001",
        type: "DOWNPAYMENT",
        netTotalCents: 300_000,
        taxTotalCents: 57_000,
        grossTotalCents: 357_000,
        taxBreakdownJson: JSON.stringify([{ taxCategory: "S", taxRate: 19, netCents: 300_000, taxCents: 57_000 }]),
        lines: [{ id: "1", description: "Abschlag 30 %", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 300_000, lineNetCents: 300_000, taxRate: 19, taxCategory: "S" }],
        sourceNumber: "AN-2040-0003",
        sourceLabel: "Angebot",
      }),
    );
    expect(buildXRechnungUBL(data)).toContain("<cbc:InvoiceTypeCode>386</cbc:InvoiceTypeCode>");
    expect(buildFacturXCII(data)).toContain("<ram:TypeCode>386</ram:TypeCode>");
    expect(validateXRechnung(data, buildXRechnungUBL(data)).errors).toEqual([]);
  });

  it("PARTIAL: InvoiceTypeCode bleibt 380 (keine Abschlagsrechnung)", () => {
    const data = buildEInvoiceData(baseInput({ type: "PARTIAL" }));
    expect(buildXRechnungUBL(data)).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(buildFacturXCII(data)).toContain("<ram:TypeCode>380</ram:TypeCode>");
  });

  it("FINAL: BT-113 = Σ Abschläge brutto, BT-115 = payableCents, BR-CO-16 hält", () => {
    const deductions = [
      { number: "AR-2040-0001", issueDate: new Date("2040-02-01"), netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
      { number: "AR-2040-0002", issueDate: new Date("2040-03-01"), netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
    ];
    const data = buildEInvoiceData(baseInput({ type: "FINAL", prepaidCents: 714_000, deductions }));

    expect(data.paidCents).toBe(714_000); // BT-113
    expect(data.payableCents).toBe(476_000); // BT-115 = 1.190.000 − 714.000
    expect(data.payableCents).toBe(data.grossTotalCents - (data.paidCents ?? 0)); // BR-CO-16

    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain('<cbc:PrepaidAmount currencyID="EUR">7140.00</cbc:PrepaidAmount>');
    expect(ubl).toContain('<cbc:PayableAmount currencyID="EUR">4760.00</cbc:PayableAmount>');
    expect(validateXRechnung(data, ubl).errors).toEqual([]);

    const cii = buildFacturXCII(data);
    expect(cii).toContain("<ram:TotalPrepaidAmount>7140.00</ram:TotalPrepaidAmount>");
    expect(cii).toContain("<ram:DuePayableAmount>4760.00</ram:DuePayableAmount>");
  });

  it("FINAL: nicht type FINAL rechnet payableCents weiter über paidAmountCents (Bestandsverhalten unveraendert)", () => {
    const data = buildEInvoiceData(baseInput({ type: "INVOICE", paidAmountCents: 50_000 }));
    expect(data.paidCents).toBe(50_000);
    expect(data.payableCents).toBe(data.grossTotalCents - 50_000);
  });
});

describe("buildXRechnungUBL — BG-3 mehrfach + BT-22 Abzugsaufstellung (Phase 5)", () => {
  const deductions = [
    { number: "AR-2040-0001", issueDate: new Date("2040-02-01"), netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
    { number: "AR-2040-0002", issueDate: new Date("2040-03-01"), netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
  ];
  const data = buildEInvoiceData(baseInput({ type: "FINAL", prepaidCents: 714_000, deductions }));

  it("emittiert je Abschlag EIN cac:BillingReference (BG-3)", () => {
    const ubl = buildXRechnungUBL(data);
    expect((ubl.match(/<cac:BillingReference>/g) ?? []).length).toBe(2);
    expect(ubl).toContain("<cbc:ID>AR-2040-0001</cbc:ID>");
    expect(ubl).toContain("<cbc:ID>AR-2040-0002</cbc:ID>");
    expect(ubl).toContain("<cbc:IssueDate>2040-02-01</cbc:IssueDate>");
    expect(ubl).toContain("<cbc:IssueDate>2040-03-01</cbc:IssueDate>");
  });

  it("emittiert je Abschlag EIN ram:InvoiceReferencedDocument (CII, nach der Summation)", () => {
    const cii = buildFacturXCII(data);
    expect((cii.match(/<ram:InvoiceReferencedDocument>/g) ?? []).length).toBe(2);
    expect(cii).toContain("<ram:IssuerAssignedID>AR-2040-0001</ram:IssuerAssignedID>");
    expect(cii).toContain("<qdt:DateTimeString format=\"102\">20400201</qdt:DateTimeString>");
    const dueIdx = cii.indexOf("<ram:DuePayableAmount>");
    const refIdx = cii.indexOf("<ram:InvoiceReferencedDocument>");
    expect(refIdx).toBeGreaterThan(dueIdx);
  });

  it("BT-22: zusätzliches cbc:Note mit der Abzugsaufstellung, bestehender Hinweis bleibt erhalten", () => {
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("<cbc:Note>Vielen Dank für Ihren Auftrag.</cbc:Note>");
    expect(ubl).toContain(
      "<cbc:Note>Abzüge: AR-2040-0001 vom 01.02.2040: 3.000,00 netto + 570,00 USt = 3.570,00; AR-2040-0002 vom 01.03.2040: 3.000,00 netto + 570,00 USt = 3.570,00</cbc:Note>",
    );
  });

  it("BT-22 (CII): zusätzliches ram:IncludedNote mit der Abzugsaufstellung", () => {
    const cii = buildFacturXCII(data);
    expect(cii).toContain("Abzüge: AR-2040-0001 vom 01.02.2040");
  });

  it("ohne precedingInvoices bleibt das Einzelverhalten (Storno/Korrektur) unveraendert", () => {
    const credit = { ...data, type: "CREDIT_NOTE", deductions: undefined, precedingInvoices: undefined, precedingInvoiceNumber: "RE-2040-0003", precedingInvoiceDate: new Date("2040-04-01") };
    const ubl = buildXRechnungUBL(credit);
    expect((ubl.match(/<cac:BillingReference>/g) ?? []).length).toBe(1);
    expect(ubl).toContain("<cbc:ID>RE-2040-0003</cbc:ID>");
    const cii = buildFacturXCII(credit);
    expect((cii.match(/<ram:InvoiceReferencedDocument>/g) ?? []).length).toBe(1);
    expect(cii).toContain("<ram:IssuerAssignedID>RE-2040-0003</ram:IssuerAssignedID>");
  });
});

describe("renderInvoicePdf — Phase 5 Titel/Bezug/Abzugsblock/§13-Hinweis", () => {
  it("Abschlagsrechnung: rendert mit Anzahlungs-Hinweis ohne Fehler", async () => {
    const data = buildEInvoiceData(
      baseInput({
        type: "DOWNPAYMENT",
        netTotalCents: 300_000,
        taxTotalCents: 57_000,
        grossTotalCents: 357_000,
        taxBreakdownJson: JSON.stringify([{ taxCategory: "S", taxRate: 19, netCents: 300_000, taxCents: 57_000 }]),
        lines: [{ id: "1", description: "Abschlag 30 %", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 300_000, lineNetCents: 300_000, taxRate: 19, taxCategory: "S" }],
        sourceNumber: "AN-2040-0003",
        sourceLabel: "Angebot",
      }),
    );
    const pdf = await renderInvoicePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("Teilrechnung: rendert mit Quellbezug ohne Fehler", async () => {
    const data = buildEInvoiceData(baseInput({ type: "PARTIAL", sourceNumber: "AN-2040-0004", sourceLabel: "Angebot" }));
    const pdf = await renderInvoicePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("Schlussrechnung: rendert mit Abzugsblock + Restbetrag ohne Fehler", async () => {
    const deductions = [
      { number: "AR-2040-0001", issueDate: new Date("2040-02-01"), netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
      { number: "AR-2040-0002", issueDate: new Date("2040-03-01"), netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
    ];
    const data = buildEInvoiceData(baseInput({ type: "FINAL", prepaidCents: 714_000, deductions, sourceNumber: "AN-2040-0003", sourceLabel: "Angebot" }));
    const pdf = await renderInvoicePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
