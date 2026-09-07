import { describe, it, expect } from "vitest";
import { splitByTaxRate, deductionsFor, bucketsFromLines, bucketsGrossTotalCents, formatPermilleDE, type DeductionInput } from "@/lib/pricing/partial";
import { PricingError } from "@/lib/pricing/errors";
import type { RateBucket } from "@/lib/pricing/allocate";

describe("splitByTaxRate", () => {
  it("Promille-Anteil: Abschlag 30 % auf 10.000,00 €/19 %", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const [r] = splitByTaxRate(buckets, { permille: 300 });
    expect(r.netCents).toBe(300_000);
    expect(r.taxCents).toBe(57_000);
    expect(r.grossCents).toBe(357_000);
  });

  it("zwei Abschläge à 30 % summieren sich korrekt (für den Restbetrag-Test unten)", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const first = splitByTaxRate(buckets, { permille: 300 })[0];
    const second = splitByTaxRate(buckets, { permille: 300 })[0];
    expect(first).toEqual(second);
    expect(first.netCents + second.netCents).toBe(600_000);
  });

  it("Festbetrag netto: verteilt proportional zum Netto der Buckets, Summe exakt", () => {
    const buckets: RateBucket[] = [
      { key: "19|S", taxRate: 19, taxCategory: "S", netCents: 700_000 },
      { key: "7|S", taxRate: 7, taxCategory: "S", netCents: 300_000 },
    ];
    const result = splitByTaxRate(buckets, { amountCents: 100_000, isGross: false });
    expect(result.reduce((s, r) => s + r.netCents, 0)).toBe(100_000);
    expect(result[0].netCents).toBe(70_000);
    expect(result[1].netCents).toBe(30_000);
  });

  it("Festbetrag netto darf die Nettosumme nicht übersteigen", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1000 }];
    expect(() => splitByTaxRate(buckets, { amountCents: 1001, isGross: false })).toThrow(PricingError);
  });

  it("Festbetrag brutto, gemischte Sätze 19 %/7 %, 1.000,00 € — Aufteilung exakt", () => {
    const buckets: RateBucket[] = [
      { key: "19|S", taxRate: 19, taxCategory: "S", netCents: 50_000 },
      { key: "7|S", taxRate: 7, taxCategory: "S", netCents: 50_000 },
    ];
    const result = splitByTaxRate(buckets, { amountCents: 100_000, isGross: true });
    expect(result.reduce((s, r) => s + r.grossCents, 0)).toBe(100_000);
    const r19 = result.find((r) => r.taxRate === 19)!;
    const r7 = result.find((r) => r.taxRate === 7)!;
    expect(r19.grossCents).toBe(52_655);
    expect(r19.netCents).toBe(44_248);
    expect(r19.taxCents).toBe(8_407);
    expect(r7.grossCents).toBe(47_345);
    expect(r7.netCents).toBe(44_248);
    expect(r7.taxCents).toBe(3_097);
    // Netto + Steuer ergibt je Bucket wieder exakt den Bruttobetrag.
    for (const r of result) expect(r.netCents + r.taxCents).toBe(r.grossCents);
  });

  it("Festbetrag brutto darf die Bruttosumme nicht übersteigen", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1000 }];
    expect(() => splitByTaxRate(buckets, { amountCents: 1_190_000, isGross: true })).toThrow(PricingError);
  });

  it("negative Permille wirft PricingError", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1000 }];
    expect(() => splitByTaxRate(buckets, { permille: -1 })).toThrow(PricingError);
  });

  it("Permille über 1000 wirft PricingError", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1000 }];
    expect(() => splitByTaxRate(buckets, { permille: 1001 })).toThrow(PricingError);
  });

  it("negativer amountCents wirft PricingError", () => {
    const buckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1000 }];
    expect(() => splitByTaxRate(buckets, { amountCents: -1 })).toThrow(PricingError);
  });

  it("leere Buckets ergeben leeres Ergebnis", () => {
    expect(splitByTaxRate([], { permille: 300 })).toEqual([]);
  });
});

describe("deductionsFor", () => {
  it("Schlussrechnung 10.000,00 €/19 % abzüglich zweier Abschläge à 3.000,00 € netto -> Rest 4.000/760/4.760", () => {
    const finalBuckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const downpayments: DeductionInput[] = [
      { taxRate: 19, taxCategory: "S", netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
      { taxRate: 19, taxCategory: "S", netCents: 300_000, taxCents: 57_000, grossCents: 357_000 },
    ];
    const result = deductionsFor(finalBuckets, downpayments);
    expect(result.perRate).toHaveLength(1);
    const [rate] = result.perRate;
    expect(rate.deductedNetCents).toBe(600_000);
    expect(rate.deductedTaxCents).toBe(114_000);
    expect(rate.deductedGrossCents).toBe(714_000);
    expect(rate.remainingNetCents).toBe(400_000);
    expect(rate.remainingTaxCents).toBe(76_000);
    expect(rate.remainingGrossCents).toBe(476_000);
    expect(result.totalRemainingNetCents).toBe(400_000);
    expect(result.totalRemainingTaxCents).toBe(76_000);
    expect(result.totalRemainingGrossCents).toBe(476_000);
  });

  it("ohne Abschläge bleibt die volle Gesamtleistung als Rest", () => {
    const finalBuckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const result = deductionsFor(finalBuckets, []);
    expect(result.totalDeductedGrossCents).toBe(0);
    expect(result.totalRemainingGrossCents).toBe(1_190_000);
  });

  it("mehrere Steuersätze werden unabhängig verrechnet", () => {
    const finalBuckets: RateBucket[] = [
      { key: "19|S", taxRate: 19, taxCategory: "S", netCents: 100_000 },
      { key: "7|S", taxRate: 7, taxCategory: "S", netCents: 100_000 },
    ];
    const downpayments: DeductionInput[] = [
      { taxRate: 19, taxCategory: "S", netCents: 50_000, taxCents: 9_500, grossCents: 59_500 },
    ];
    const result = deductionsFor(finalBuckets, downpayments);
    const r19 = result.perRate.find((r) => r.taxRate === 19)!;
    const r7 = result.perRate.find((r) => r.taxRate === 7)!;
    expect(r19.remainingGrossCents).toBe(59_500);
    expect(r7.remainingGrossCents).toBe(107_000);
    expect(r7.deductedGrossCents).toBe(0);
  });

  it("Summe der Abschläge über der Gesamtleistung (je Satz) wirft PricingError", () => {
    const finalBuckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const downpayments: DeductionInput[] = [
      { taxRate: 19, taxCategory: "S", netCents: 600_000, taxCents: 114_000, grossCents: 714_000 },
      { taxRate: 19, taxCategory: "S", netCents: 600_000, taxCents: 114_000, grossCents: 714_000 },
    ];
    expect(() => deductionsFor(finalBuckets, downpayments)).toThrow(PricingError);
  });

  it("Abschlag mit Steuersatz ohne Entsprechung in der Gesamtleistung wirft PricingError", () => {
    const finalBuckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const downpayments: DeductionInput[] = [
      { taxRate: 7, taxCategory: "S", netCents: 1_000, taxCents: 70, grossCents: 1_070 },
    ];
    expect(() => deductionsFor(finalBuckets, downpayments)).toThrow(PricingError);
  });

  it("negative Beträge in einer Abschlagszeile werfen PricingError", () => {
    const finalBuckets: RateBucket[] = [{ key: "19|S", taxRate: 19, taxCategory: "S", netCents: 1_000_000 }];
    const downpayments: DeductionInput[] = [
      { taxRate: 19, taxCategory: "S", netCents: -1, taxCents: 0, grossCents: -1 },
    ];
    expect(() => deductionsFor(finalBuckets, downpayments)).toThrow(PricingError);
  });
});

describe("bucketsFromLines (Fix-Runde 1, LOW: gemeinsamer Helper fuer partial.ts/downpayment.ts)", () => {
  it("gruppiert Zeilen nach (taxCategory, taxRate) und summiert lineNetCents", () => {
    const buckets = bucketsFromLines([
      { taxRate: 19, taxCategory: "S", lineNetCents: 100_000 },
      { taxRate: 7, taxCategory: "S", lineNetCents: 50_000 },
      { taxRate: 19, taxCategory: "S", lineNetCents: 25_000 },
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets.find((b) => b.taxRate === 19)?.netCents).toBe(125_000);
    expect(buckets.find((b) => b.taxRate === 7)?.netCents).toBe(50_000);
  });

  it("liefert ein leeres Array fuer keine Zeilen", () => {
    expect(bucketsFromLines([])).toEqual([]);
  });
});

describe("bucketsGrossTotalCents (Fix-Runde 1, HIGH: Gesamtleistung brutto fuer den Ueberbuchungs-Guard)", () => {
  it("summiert die Bruttobetraege ueber gemischte Steuersaetze", () => {
    const buckets: RateBucket[] = [
      { key: "S:19", taxRate: 19, taxCategory: "S", netCents: 500_000 },
      { key: "S:7", taxRate: 7, taxCategory: "S", netCents: 500_000 },
    ];
    // 500.000*1,19 + 500.000*1,07 = 595.000 + 535.000 = 1.130.000
    expect(bucketsGrossTotalCents(buckets)).toBe(1_130_000);
  });

  it("liefert 0 fuer keine Buckets", () => {
    expect(bucketsGrossTotalCents([])).toBe(0);
  });
});

describe("formatPermilleDE (Fix-Runde 1, LOW: gemeinsamer Helper)", () => {
  it("formatiert glatte Zehntel ohne Nachkommastelle", () => {
    expect(formatPermilleDE(300)).toBe("30");
    expect(formatPermilleDE(1000)).toBe("100");
  });

  it("formatiert Achtel-Prozent mit einer Nachkommastelle", () => {
    expect(formatPermilleDE(335)).toBe("33,5");
  });
});
