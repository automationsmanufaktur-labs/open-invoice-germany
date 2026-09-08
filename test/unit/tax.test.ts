import { describe, it, expect } from "vitest";
import { computeTaxBreakdown, defaultCategoryForScheme, ZERO_TAX_SCHEMES, EU_COUNTRY_CODES, EU_VAT_PREFIXES } from "@/lib/tax";
import { SCHEME_NOTICE, SCHEME_NOTICE_ACCEPTED, normalizeNotice } from "@/domain/invoice/mandatory";

describe("tax", () => {
  it("gruppiert nach Satz/Kategorie und rundet pro Gruppe (EN 16931)", () => {
    const t = computeTaxBreakdown([
      { lineNetCents: 10000, taxRate: 19, taxCategory: "S" },
      { lineNetCents: 5000, taxRate: 19, taxCategory: "S" },
      { lineNetCents: 10000, taxRate: 7, taxCategory: "S" },
    ]);
    expect(t.netTotalCents).toBe(25000);
    // 19 % von 15000 = 2850 ; 7 % von 10000 = 700
    expect(t.taxTotalCents).toBe(3550);
    expect(t.grossTotalCents).toBe(28550);
    expect(t.breakdown).toHaveLength(2);
  });

  it("Reverse Charge / 0 % erzeugt keine Steuer", () => {
    const t = computeTaxBreakdown([{ lineNetCents: 50000, taxRate: 0, taxCategory: "AE" }]);
    expect(t.taxTotalCents).toBe(0);
    expect(t.grossTotalCents).toBe(50000);
  });
});

describe("Steuerkategorie, Listen und Hinweistexte (Phase 12b)", () => {
  it("DIFFERENZ ist E (BR-S-05: S verlangt Satz > 0), AUSFUHR ist G, Bestand unveraendert", () => {
    expect(["REGULAR", "KLEINUNTERNEHMER", "REVERSE_CHARGE", "IG_LIEFERUNG", "IG_LEISTUNG", "DIFFERENZ", "AUSFUHR"].map(defaultCategoryForScheme))
      .toEqual(["S", "E", "AE", "K", "AE", "E", "G"]);
  });
  it("ZERO_TAX_SCHEMES deckt alle sechs Nullsatz-Schemata ab, nicht REGULAR", () => {
    for (const s of ["KLEINUNTERNEHMER", "REVERSE_CHARGE", "IG_LIEFERUNG", "IG_LEISTUNG", "DIFFERENZ", "AUSFUHR"]) expect(ZERO_TAX_SCHEMES.has(s)).toBe(true);
    expect(ZERO_TAX_SCHEMES.has("REGULAR")).toBe(false);
  });
  it("EU-Listen: 27 Laender, CH draussen, EL/XI nur als VAT-Praefix", () => {
    expect([EU_COUNTRY_CODES.size, EU_COUNTRY_CODES.has("GR"), EU_COUNTRY_CODES.has("CH")]).toEqual([27, true, false]);
    expect([EU_VAT_PREFIXES.has("EL"), EU_VAT_PREFIXES.has("XI"), EU_VAT_PREFIXES.has("GR")]).toEqual([true, true, false]);
  });
  it("sechs Schemata tragen einen Text, REGULAR nicht", () => {
    expect(Object.keys(SCHEME_NOTICE).sort()).toEqual(["AUSFUHR", "DIFFERENZ", "IG_LEISTUNG", "IG_LIEFERUNG", "KLEINUNTERNEHMER", "REVERSE_CHARGE"]);
    expect(SCHEME_NOTICE.REGULAR).toBeUndefined();
  });
  it("normalizeNotice faltet Umlaute, ss und Mehrfach-Whitespace", () => {
    expect(normalizeNotice("Steuerfreie   Ausfuhrlieferung")).toBe("steuerfreie ausfuhrlieferung");
    expect(normalizeNotice("Gebrauchtgegenstände/Sonderregelung")).toBe("gebrauchtgegenstaende/sonderregelung");
    expect(normalizeNotice("gemäß Maß")).toBe("gemaess mass");
  });
  it("jeder eigene Text erfuellt sein SCHEME_NOTICE_ACCEPTED; § 25a alle drei Formulierungen (§ 14a Abs. 6)", () => {
    for (const [scheme, text] of Object.entries(SCHEME_NOTICE)) {
      expect(SCHEME_NOTICE_ACCEPTED[scheme].some((re) => re.test(normalizeNotice(text)))).toBe(true);
    }
    for (const t of ["Gebrauchtgegenstände/Sonderregelung", "Kunstgegenstände/Sonderregelung", "Sammlungsstücke und Antiquitäten/Sonderregelung"]) {
      expect(SCHEME_NOTICE_ACCEPTED.DIFFERENZ.some((re) => re.test(normalizeNotice(t)))).toBe(true);
    }
  });
});
