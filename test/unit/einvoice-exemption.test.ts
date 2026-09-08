import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exemptionReasonText, exemptionReasonCode } from "@/lib/einvoice/exemption";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { buildFacturXCII } from "@/lib/einvoice/cii";
import type { EInvoiceData } from "@/lib/einvoice/types";

/** Minimalbeleg mit Nullsatz in der gewuenschten Steuerkategorie. */
function zeroRated(category: string): EInvoiceData {
  const netCents = 20000;
  return {
    number: "RE-2041-9001", type: "INVOICE",
    issueDate: new Date("2041-06-09"), dueDate: new Date("2041-06-23"), deliveryDate: new Date("2041-06-01"),
    currency: "EUR", buyerReference: "04011000-12345-86", notes: "Testbeleg",
    seller: { name: "Test GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", countryCode: "DE", vatId: "DE123456789", email: "info@test.de", phone: "+49 4131 100", contactName: "Max Mustermann" },
    buyer: { name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", countryCode: "DE", vatId: "DE987654321", email: "einkauf@kunde.de" },
    lines: [{ id: "1", description: "Leistung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, lineNetCents: netCents, taxRate: 0, taxCategory: category, lineType: "ITEM" }],
    taxSubtotals: [{ taxCategory: category, taxRate: 0, netCents, taxCents: 0 }],
    netTotalCents: netCents, taxTotalCents: 0, grossTotalCents: netCents, payableCents: netCents,
    iban: "DE02120300000000202051",
  };
}

describe("BT-120 / BT-121 (Phase 12b)", () => {
  it("Text fuer alle befreiten Kategorien, nichts fuer S; VATEX-Code nur fuer AE/K/G/O", () => {
    expect(["AE", "K", "G", "E", "Z", "O"].map(exemptionReasonText)).toEqual([
      "Steuerschuldnerschaft des Leistungsempfängers", "Innergemeinschaftliche Lieferung",
      "Ausfuhrlieferung", "Steuerbefreit", "Nullsatz", "Nicht steuerbar",
    ]);
    expect(exemptionReasonText("S")).toBeNull();
    expect(["AE", "K", "G", "O"].map(exemptionReasonCode)).toEqual(["VATEX-EU-AE", "VATEX-EU-IC", "VATEX-EU-G", "VATEX-EU-O"]);
    // § 19 (E) und Nullsatz (Z) haben keinen passenden EU-Code.
    for (const c of ["E", "Z", "S"]) expect(exemptionReasonCode(c)).toBeNull();
  });
  it("xrechnung.ts und cii.ts definieren exemptionReason nicht mehr selbst", () => {
    const dir = path.resolve(__dirname, "../../src/lib/einvoice");
    for (const f of ["xrechnung.ts", "cii.ts"]) {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text).not.toMatch(/function exemptionReason\s*\(/);
      expect(text).toMatch(/from "\.\/exemption"/);
    }
  });
  it("UBL setzt ReasonCode VOR Reason, CII den Code nach CategoryCode und vor RateApplicablePercent", () => {
    const ubl = buildXRechnungUBL(zeroRated("AE"));
    expect(ubl).toContain("<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>");
    expect(ubl.indexOf("TaxExemptionReasonCode")).toBeLessThan(ubl.indexOf("<cbc:TaxExemptionReason>"));
    const cii = buildFacturXCII(zeroRated("AE"));
    expect(cii).toContain("<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>");
    // Zeilen tragen ihr eigenes ApplicableTradeTax (mit eigenem CategoryCode/RateApplicablePercent)
    // VOR dem Kopf-ApplicableTradeTax — die Reihenfolge wird darum relativ zum
    // Kopf-ExemptionReasonCode geprueft statt mit dem ersten Treffer im Gesamtdokument.
    const exemptionCodeIdx = cii.indexOf("<ram:ExemptionReasonCode>");
    expect(cii.lastIndexOf("<ram:CategoryCode>", exemptionCodeIdx)).toBeLessThan(exemptionCodeIdx);
    expect(exemptionCodeIdx).toBeLessThan(cii.indexOf("<ram:RateApplicablePercent>", exemptionCodeIdx));
  });
  it("Kategorie E bekommt Text, aber KEINEN Code", () => {
    const ubl = buildXRechnungUBL(zeroRated("E"));
    expect(ubl).toContain("<cbc:TaxExemptionReason>Steuerbefreit</cbc:TaxExemptionReason>");
    expect(ubl).not.toContain("TaxExemptionReasonCode");
  });
});
