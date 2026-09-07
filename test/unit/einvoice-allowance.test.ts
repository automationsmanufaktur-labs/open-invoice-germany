/**
 * Phase 4a — AllowanceCharge/Skonto/PaymentMeans im E-Rechnungs-Mapping.
 *
 * Prüft die EN-16931-Rechenregeln (BR-CO-10/11/12/13) UNABHÄNGIG vom Schematron-
 * Validator (der laeuft separat via `npm run validate:erechnung`, siehe
 * scripts/validate-erechnung.ts) sowie die XSD-Elementreihenfolge und die
 * BR-DE-23-Regel (PayeeFinancialAccount nur bei Ueberweisung/Lastschrift).
 */
import { describe, it, expect } from "vitest";
import { buildEInvoiceData, type MapInput } from "@/lib/einvoice/mapper";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { buildFacturXCII } from "@/lib/einvoice/cii";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { computeLineNet } from "@/lib/pricing/line";
import { computeTaxBreakdown } from "@/lib/tax";
import type { DocumentAdjustments } from "@/lib/pricing/allocate";

const ORG: MapInput["org"] = {
  legalName: "Test GmbH", addressLine1: "Hauptstr. 1", addressLine2: null, postalCode: "21339", city: "Lüneburg",
  country: "DE", vatId: "DE123456789", taxNumber: null, email: "info@test.de", phone: null,
  electronicAddress: null, iban: "DE02120300000000202051", bic: "BYLADEM1001", bankName: "Test Bank",
};
const CUSTOMER: MapInput["customer"] = {
  name: "Kunde AG", contactName: null, addressLine1: "Marktplatz 2", addressLine2: null, postalCode: "20095",
  city: "Hamburg", countryCode: "DE", vatId: "DE987654321", email: "einkauf@kunde.de", leitwegId: null,
};

interface SampleLine {
  description: string;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents: number;
  taxRate: number;
  taxCategory: string;
  discountPermille?: number;
  discountCents?: number;
}

function build(opts: {
  lines: SampleLine[];
  adjustments?: DocumentAdjustments;
  documentChargeReason?: string | null;
  skonto1?: { permille: number; days: number };
  skonto2?: { permille: number; days: number };
  paymentMethodSnapshotJson?: string | null;
  paidAmountCents?: number;
  type?: string;
  org?: MapInput["org"];
  paymentTerms?: string | null;
  // Fix-Runde 1 (Befund A): Gutschrift — Betraege gespiegelt (negativ), quantityMilli
  // bleibt POSITIV (Bestandskonvention, siehe src/domain/invoice/cancel.ts).
  sign?: 1 | -1;
}) {
  const sign = opts.sign ?? 1;
  const lines = opts.lines.map((l) => {
    const lineNetCents = computeLineNet({
      quantityMilli: l.quantityMilli,
      unitNetPriceCents: l.unitNetPriceCents,
      discountPermille: l.discountPermille,
      discountCents: l.discountCents,
    }).lineNetCents;
    return { ...l, unitNetPriceCents: l.unitNetPriceCents * sign, lineNetCents: lineNetCents * sign };
  });
  const totals = computeTaxBreakdown(
    lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    opts.adjustments,
  );
  const mapInput: MapInput = {
    number: "RE-2034-0100",
    type: opts.type ?? "INVOICE",
    issueDate: new Date("2034-06-09"),
    dueDate: new Date("2034-07-09"),
    deliveryDate: new Date("2034-06-01"),
    currency: "EUR",
    buyerReference: null,
    paymentTerms: opts.paymentTerms !== undefined ? opts.paymentTerms : opts.skonto1 ? null : "Zahlbar innerhalb von 30 Tagen ohne Abzug.",
    notes: null,
    netTotalCents: totals.netTotalCents,
    taxTotalCents: totals.taxTotalCents,
    grossTotalCents: totals.grossTotalCents,
    paidAmountCents: opts.paidAmountCents ?? 0,
    taxBreakdownJson: JSON.stringify(totals.breakdown),
    documentChargeReason: opts.documentChargeReason ?? null,
    skonto1Permille: opts.skonto1?.permille ?? null,
    skonto1Days: opts.skonto1?.days ?? null,
    skonto2Permille: opts.skonto2?.permille ?? null,
    skonto2Days: opts.skonto2?.days ?? null,
    paymentMethodSnapshotJson: opts.paymentMethodSnapshotJson ?? null,
    org: opts.org ?? ORG,
    customer: CUSTOMER,
    lines: lines.map((l, i) => ({
      id: String(i + 1),
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitNetPriceCents: l.unitNetPriceCents,
      lineNetCents: l.lineNetCents,
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
      discountPermille: l.discountPermille,
      discountCents: l.discountCents,
    })),
  };
  return buildEInvoiceData(mapInput);
}

const ORG_NO_IBAN: MapInput["org"] = { ...ORG, iban: null, bic: null, bankName: null };

describe("EN-16931-Rechenregeln (BR-CO-10/11/12/13) — unabhängig vom Schematron", () => {
  it("Positionsrabatt: Σ LineExtension − Allowance + Charge = TaxExclusive (ohne Belegrabatt)", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S", discountPermille: 100 }],
    });
    const lineSum = data.lines.reduce((s, l) => s + l.lineNetCents, 0);
    expect(lineSum).toBe(data.lineTotalCents);
    expect((data.allowanceTotalCents ?? 0) + (data.chargeTotalCents ?? 0)).toBe(0);
    expect((data.lineTotalCents ?? 0) - (data.allowanceTotalCents ?? 0) + (data.chargeTotalCents ?? 0)).toBe(data.netTotalCents);
    expect(validateXRechnung(data, buildXRechnungUBL(data)).errors).toEqual([]);
  });

  it("Belegrabatt über zwei Steuersätze: BR-CO-10/11/13 rechnerisch korrekt", () => {
    const data = build({
      lines: [
        { description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S" },
        { description: "Fachliteratur", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 8000, taxRate: 7, taxCategory: "S" },
      ],
      adjustments: { discountPermille: 100 },
    });
    const lineSum = data.lines.reduce((s, l) => s + l.lineNetCents, 0);
    const allowanceSum = (data.taxSubtotals ?? []).reduce((s, t) => s + (t.allowanceCents ?? 0), 0);
    const chargeSum = (data.taxSubtotals ?? []).reduce((s, t) => s + (t.chargeCents ?? 0), 0);
    // BR-CO-10
    expect(lineSum).toBe(data.lineTotalCents);
    // BR-CO-11/12
    expect(allowanceSum).toBe(data.allowanceTotalCents);
    expect(chargeSum).toBe(data.chargeTotalCents);
    // BR-CO-13
    expect(lineSum - allowanceSum + chargeSum).toBe(data.netTotalCents);
    expect(data.documentAllowances).toHaveLength(2);
    expect(validateXRechnung(data, buildXRechnungUBL(data)).errors).toEqual([]);
    expect(() => buildFacturXCII(data)).not.toThrow();
  });

  it("Belegaufschlag: BR-CO-12/13 rechnerisch korrekt, Freitext-Grund im XML", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S" }],
      adjustments: { chargePermille: 50 },
      documentChargeReason: "Express-Zuschlag",
    });
    const lineSum = data.lines.reduce((s, l) => s + l.lineNetCents, 0);
    expect(lineSum - (data.allowanceTotalCents ?? 0) + (data.chargeTotalCents ?? 0)).toBe(data.netTotalCents);
    expect(data.documentCharges).toHaveLength(1);
    expect(data.documentCharges![0].reason).toBe("Express-Zuschlag");
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("Express-Zuschlag");
    expect(ubl).toContain("<cbc:ChargeIndicator>true</cbc:ChargeIndicator>");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
    const cii = buildFacturXCII(data);
    expect(cii).toContain("Express-Zuschlag");
  });

  it("UBL: Dokument-AllowanceCharge steht nach PaymentTerms und vor TaxTotal", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S" }],
      adjustments: { discountPermille: 100 },
    });
    const xml = buildXRechnungUBL(data);
    const paymentTermsIdx = xml.indexOf("<cac:PaymentTerms>");
    const allowanceIdx = xml.indexOf("<cac:AllowanceCharge>");
    const taxTotalIdx = xml.indexOf("<cac:TaxTotal>");
    expect(allowanceIdx).toBeGreaterThan(paymentTermsIdx);
    expect(allowanceIdx).toBeLessThan(taxTotalIdx);
  });

  it("UBL: Zeilen-AllowanceCharge steht nach LineExtensionAmount und vor Item", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S", discountPermille: 100 }],
    });
    const xml = buildXRechnungUBL(data);
    const lineExtIdx = xml.indexOf("<cbc:LineExtensionAmount");
    const allowanceIdx = xml.indexOf("<cac:AllowanceCharge>");
    const itemIdx = xml.indexOf("<cac:Item>");
    expect(allowanceIdx).toBeGreaterThan(lineExtIdx);
    expect(allowanceIdx).toBeLessThan(itemIdx);
  });

  it("Skonto mit zwei Zielen: BT-20 traegt die #SKONTO#-Syntax", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S" }],
      skonto1: { permille: 20, days: 7 },
      skonto2: { permille: 10, days: 14 },
    });
    expect(data.paymentTermsNote).toContain("#SKONTO#TAGE=7#PROZENT=2.00#");
    expect(data.paymentTermsNote).toContain("#SKONTO#TAGE=14#PROZENT=1.00#");
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("#SKONTO#TAGE=7#PROZENT=2.00#");
    const cii = buildFacturXCII(data);
    expect(cii).toContain("#SKONTO#TAGE=7#PROZENT=2.00#");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
  });

  it("Barzahlung (CASH, UNTDID 10): kein PayeeFinancialAccount (BR-DE-23)", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S" }],
      paymentMethodSnapshotJson: JSON.stringify({
        code: "CASH", name: "Barzahlung", invoiceText: "Zahlung bar bei Übergabe.", untdidCode: "10",
        bankIban: null, bankBic: null, bankName: null,
      }),
    });
    expect(data.paymentMeans?.code).toBe("10");
    expect(data.paymentMethodText).toBe("Zahlung bar bei Übergabe.");
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>");
    expect(ubl).not.toContain("PayeeFinancialAccount");
    const cii = buildFacturXCII(data);
    expect(cii).toContain("<ram:TypeCode>10</ram:TypeCode>");
    expect(cii).not.toContain("PayeePartyCreditorFinancialAccount");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
  });

  it("Ueberweisung (SEPA, code 58) traegt PayeeFinancialAccount aus abweichendem Methoden-Konto", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentMethodSnapshotJson: JSON.stringify({
        code: "TRANSFER", name: "Ueberweisung", invoiceText: null, untdidCode: "58",
        bankIban: "DE44500105175407324931", bankBic: "INGDDEFFXXX", bankName: "ING",
      }),
    });
    expect(data.paymentMeans).toEqual({ code: "58", iban: "DE44500105175407324931", bic: "INGDDEFFXXX", accountName: "ING" });
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("DE44500105175407324931");
    expect(ubl).not.toContain(ORG.iban!);
  });

  it("Alt-Beleg ohne Rabatt/Skonto/Methode: keine AllowanceCharge, PaymentMeans identisch zum Org-Fallback", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
    });
    expect(data.documentAllowances).toEqual([]);
    expect(data.documentCharges).toEqual([]);
    expect(data.lines[0].discountCents).toBe(0);
    expect(data.paymentMeans).toEqual({ code: "58", iban: ORG.iban, bic: ORG.bic, accountName: ORG.bankName });
    const ubl = buildXRechnungUBL(data);
    expect(ubl).not.toContain("AllowanceCharge");
  });
});

describe("Fix-Runde 1", () => {
  it("Befund A — Gutschrift mit Belegrabatt: BR-CO-13 rechnerisch korrekt, Amount/BaseAmount positiv im XML", () => {
    const data = build({
      type: "CREDIT_NOTE",
      sign: -1,
      lines: [{ description: "Beratung (Storno)", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      adjustments: { discountPermille: 100 },
    });
    // Gutschrift −10000 (19 %) mit 10 % Belegrabatt: LineExtension 100,00, AllowanceTotal
    // 10,00, TaxExclusive 90,00 (Betraege intern negativ, XML positiv/TypeCode 381).
    expect(data.lineTotalCents).toBe(-10000);
    expect(data.allowanceTotalCents).toBe(-1000);
    expect((data.lineTotalCents ?? 0) - (data.allowanceTotalCents ?? 0) + (data.chargeTotalCents ?? 0)).toBe(data.netTotalCents);
    expect(data.netTotalCents).toBe(-9000);
    expect(data.documentAllowances).toHaveLength(1);
    expect(data.documentAllowances![0]).toEqual({ amountCents: 1000, baseCents: 10000, taxRate: 19, taxCategory: "S", reason: "Rabatt" });

    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("<cbc:LineExtensionAmount currencyID=\"EUR\">100.00</cbc:LineExtensionAmount>");
    expect(ubl).toContain("<cbc:AllowanceTotalAmount currencyID=\"EUR\">10.00</cbc:AllowanceTotalAmount>");
    expect(ubl).toContain("<cbc:TaxExclusiveAmount currencyID=\"EUR\">90.00</cbc:TaxExclusiveAmount>");
    expect(ubl).toContain("<cbc:Amount currencyID=\"EUR\">10.00</cbc:Amount>");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
    expect(() => buildFacturXCII(data)).not.toThrow();
  });

  it("Befund B — ohne Methode und ohne Org-IBAN: PaymentMeans mit Code 1 (Instrument not defined), kein Konto", () => {
    const data = build({
      org: ORG_NO_IBAN,
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
    });
    expect(data.paymentMeans).toEqual({ code: "1", iban: null, bic: null, accountName: null });
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("<cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>");
    expect(ubl).not.toContain("PayeeFinancialAccount");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
  });

  it("Befund B — Methode verlangt Konto (58), aber weder Methode noch Org haben IBAN: Fallback Code 1", () => {
    const data = build({
      org: ORG_NO_IBAN,
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentMethodSnapshotJson: JSON.stringify({
        code: "TRANSFER", name: "Ueberweisung", invoiceText: null, untdidCode: "58",
        bankIban: null, bankBic: null, bankName: null,
      }),
    });
    expect(data.paymentMeans).toEqual({ code: "1", iban: null, bic: null, accountName: null });
  });

  it("Befund C — paymentTermsHuman traegt bei Skonto den Klartext ohne #SKONTO#-Tags", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentTerms: null,
      skonto1: { permille: 20, days: 7 },
    });
    expect(data.paymentTermsHuman).toContain("Skonto");
    expect(data.paymentTermsHuman).not.toContain("#SKONTO#");
    expect(data.paymentTermsNote).toContain("#SKONTO#TAGE=7#PROZENT=2.00#");
  });

  it("Befund C — Alt-Beleg ohne Skonto: paymentTermsHuman === paymentTerms", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentTerms: "Zahlbar sofort.",
    });
    expect(data.paymentTermsHuman).toBe("Zahlbar sofort.");
    expect(data.paymentTermsNote).toBe("Zahlbar sofort.");
  });
});

describe("Fix-Welle (K2) — PaymentMeans-Allowlist", () => {
  it("Kartenzahlung (48): Fallback auf Code 1, kein Konto", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentMethodSnapshotJson: JSON.stringify({
        code: "CARD", name: "EC-/Debitkarte", invoiceText: "Zahlung per Karte.", untdidCode: "48",
        bankIban: null, bankBic: null, bankName: null,
      }),
    });
    expect(data.paymentMeans).toEqual({ code: "1", iban: null, bic: null, accountName: null });
    const ubl = buildXRechnungUBL(data);
    expect(ubl).toContain("<cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
  });

  it("SEPA-Lastschrift (59): Fallback auf Code 1, auch WENN eine IBAN hinterlegt ist", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentMethodSnapshotJson: JSON.stringify({
        code: "SEPA", name: "SEPA-Lastschrift", invoiceText: "Einzug per SEPA-Lastschrift.", untdidCode: "59",
        bankIban: "DE44500105175407324931", bankBic: "INGDDEFFXXX", bankName: "ING",
      }),
    });
    expect(data.paymentMeans).toEqual({ code: "1", iban: null, bic: null, accountName: null });
    const ubl = buildXRechnungUBL(data);
    expect(ubl).not.toContain("DE44500105175407324931");
    expect(validateXRechnung(data, ubl).errors).toEqual([]);
  });

  it("Kreditkarte (54): ebenfalls Fallback auf Code 1", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentMethodSnapshotJson: JSON.stringify({
        code: "CREDIT_CARD", name: "Kreditkarte", invoiceText: null, untdidCode: "54",
        bankIban: null, bankBic: null, bankName: null,
      }),
    });
    expect(data.paymentMeans?.code).toBe("1");
  });

  it("W3 — paymentTermsHuman ergaenzt bei GESETZTEM Freitext-Zahlungsziel den Skonto-Klartext (statt ihn zu verschlucken)", () => {
    const data = build({
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      paymentTerms: "Zahlbar innerhalb von 30 Tagen ohne Abzug.",
      skonto1: { permille: 20, days: 7 },
    });
    expect(data.paymentTermsHuman).toContain("Zahlbar innerhalb von 30 Tagen ohne Abzug.");
    expect(data.paymentTermsHuman).toContain("Skonto");
    expect(data.paymentTermsHuman).not.toContain("#SKONTO#");
    expect(data.paymentTermsNote).toContain("#SKONTO#TAGE=7#PROZENT=2.00#");
  });

  it("paymentMethodSchema laesst nur die Allowlist zu", async () => {
    const { paymentMethodSchema } = await import("@/schemas");
    expect(paymentMethodSchema.safeParse({ code: "X", name: "X", untdidCode: "48" }).success).toBe(true);
    expect(paymentMethodSchema.safeParse({ code: "X", name: "X", untdidCode: "59" }).success).toBe(true);
    expect(paymentMethodSchema.safeParse({ code: "X", name: "X", untdidCode: "42" }).success).toBe(false);
  });
});
