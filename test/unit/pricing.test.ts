import { describe, it, expect } from "vitest";
import { computeLineNet } from "@/lib/pricing/line";
import { allocateProportional, applyDocumentAdjustments } from "@/lib/pricing/allocate";
import { PricingError } from "@/lib/pricing/errors";
import { computeTaxBreakdown } from "@/lib/tax";

describe("computeLineNet", () => {
  it("Prozentrabatt", () => {
    const r = computeLineNet({ quantityMilli: 1000, unitNetPriceCents: 10000, discountPermille: 100 });
    expect(r.grossLineCents).toBe(10000);
    expect(r.discountTotalCents).toBe(1000);
    expect(r.lineNetCents).toBe(9000);
  });

  it("Festbetragsrabatt", () => {
    const r = computeLineNet({ quantityMilli: 1000, unitNetPriceCents: 10000, discountCents: 500 });
    expect(r.discountTotalCents).toBe(500);
    expect(r.lineNetCents).toBe(9500);
  });

  it("Prozent- und Festbetragsrabatt kombiniert", () => {
    const r = computeLineNet({
      quantityMilli: 1000,
      unitNetPriceCents: 10000,
      discountPermille: 100,
      discountCents: 500,
    });
    expect(r.discountTotalCents).toBe(1500);
    expect(r.lineNetCents).toBe(8500);
  });

  it("Rabatt darf Netto nicht unter 0 druecken", () => {
    const r = computeLineNet({ quantityMilli: 1000, unitNetPriceCents: 1000, discountCents: 5000 });
    expect(r.lineNetCents).toBe(0);
    expect(r.discountTotalCents).toBe(1000);
  });

  it("negative quantityMilli wirft PricingError (Aufrufer negiert ausserhalb, z. B. cancel.ts/credit.ts)", () => {
    expect(() => computeLineNet({ quantityMilli: -1000, unitNetPriceCents: 10000 })).toThrow(PricingError);
  });

  it("negative unitNetPriceCents wirft PricingError", () => {
    expect(() => computeLineNet({ quantityMilli: 1000, unitNetPriceCents: -10000 })).toThrow(PricingError);
  });
});

describe("allocateProportional", () => {
  it("summiert exakt trotz Rundung (drei fast gleiche Buckets)", () => {
    const result = allocateProportional(1000, [3333, 3333, 3334]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("Ties werden deterministisch nach Index verteilt", () => {
    expect(allocateProportional(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it("alle Gewichte 0 -> alles auf Index 0", () => {
    expect(allocateProportional(500, [0, 0, 0])).toEqual([500, 0, 0]);
  });

  it("leeres Array -> leeres Ergebnis", () => {
    expect(allocateProportional(500, [])).toEqual([]);
  });

  it("verteilt glatt teilbare Betraege exakt proportional", () => {
    expect(allocateProportional(1500, [30000, 10000])).toEqual([1125, 375]);
  });
});

describe("applyDocumentAdjustments", () => {
  it("verteilt 10 % Belegrabatt proportional auf zwei Buckets", () => {
    const result = applyDocumentAdjustments(
      [
        { key: "S:19", taxRate: 19, taxCategory: "S", netCents: 10000 },
        { key: "S:7", taxRate: 7, taxCategory: "S", netCents: 10000 },
      ],
      { discountPermille: 100 },
    );
    expect(result[0].allowanceCents).toBe(1000);
    expect(result[1].allowanceCents).toBe(1000);
    expect(result[0].adjustedNetCents).toBe(9000);
    expect(result[1].adjustedNetCents).toBe(9000);
  });

  it("Festbetragsrabatt auf ungleiche Buckets (300/100)", () => {
    const result = applyDocumentAdjustments(
      [
        { key: "S:19", taxRate: 19, taxCategory: "S", netCents: 30000 },
        { key: "S:7", taxRate: 7, taxCategory: "S", netCents: 10000 },
      ],
      { discountCents: 1500 },
    );
    expect(result[0].adjustedNetCents).toBe(30000 - 1125);
    expect(result[1].adjustedNetCents).toBe(10000 - 375);
  });

  it("Aufschlag wird nach dem Rabatt auf die neue Basis berechnet", () => {
    const result = applyDocumentAdjustments(
      [{ key: "S:19", taxRate: 19, taxCategory: "S", netCents: 10000 }],
      { discountPermille: 100, chargePermille: 50 },
    );
    // Basis nach 10 % Rabatt: 9000; Aufschlag 5 % davon = 450
    expect(result[0].allowanceCents).toBe(1000);
    expect(result[0].chargeCents).toBe(450);
    expect(result[0].adjustedNetCents).toBe(9450);
  });

  it("Rabatt > Netto wirft PricingError", () => {
    expect(() =>
      applyDocumentAdjustments(
        [{ key: "S:19", taxRate: 19, taxCategory: "S", netCents: 1000 }],
        { discountCents: 2000 },
      ),
    ).toThrow(PricingError);
  });

  it("0-%-Satz (Kleinunternehmer) mit Rabatt bleibt steuerfrei", () => {
    const result = applyDocumentAdjustments(
      [{ key: "E:0", taxRate: 0, taxCategory: "E", netCents: 10000 }],
      { discountPermille: 100 },
    );
    expect(result[0].adjustedNetCents).toBe(9000);
  });
});

describe("computeTaxBreakdown mit Anpassungen", () => {
  it("100 € 19 % + 100 € 7 %, 10 % Belegrabatt -> Steuer 17,10 €/6,30 €, brutto 203,40 €", () => {
    const t = computeTaxBreakdown(
      [
        { lineNetCents: 10000, taxRate: 19, taxCategory: "S" },
        { lineNetCents: 10000, taxRate: 7, taxCategory: "S" },
      ],
      { discountPermille: 100 },
    );
    const b19 = t.breakdown.find((e) => e.taxRate === 19)!;
    const b7 = t.breakdown.find((e) => e.taxRate === 7)!;
    expect(b19.taxCents).toBe(1710);
    expect(b7.taxCents).toBe(630);
    expect(t.grossTotalCents).toBe(20340);
    expect(t.lineTotalCents).toBe(20000);
    expect(t.allowanceTotalCents).toBe(2000);
  });

  it("Reverse-Charge (0 %) bleibt bei Anpassung unveraendert in der Steuer", () => {
    const t = computeTaxBreakdown(
      [{ lineNetCents: 50000, taxRate: 0, taxCategory: "AE" }],
      { discountPermille: 100 },
    );
    expect(t.taxTotalCents).toBe(0);
    expect(t.breakdown[0].netCents).toBe(45000);
  });

  it("ohne Anpassungen byte-gleich zum Bestand (Regression)", () => {
    const t = computeTaxBreakdown([
      { lineNetCents: 10000, taxRate: 19, taxCategory: "S" },
      { lineNetCents: 5000, taxRate: 19, taxCategory: "S" },
      { lineNetCents: 10000, taxRate: 7, taxCategory: "S" },
    ]);
    expect(t.netTotalCents).toBe(25000);
    expect(t.taxTotalCents).toBe(3550);
    expect(t.grossTotalCents).toBe(28550);
    expect(t.breakdown).toHaveLength(2);
    expect(t.lineTotalCents).toBe(25000);
    expect(t.allowanceTotalCents).toBe(0);
    expect(t.chargeTotalCents).toBe(0);
    expect(t.breakdown.every((e) => e.allowanceCents === 0 && e.chargeCents === 0)).toBe(true);
    expect(t.breakdown.every((e) => e.netCents === e.baseNetCents)).toBe(true);
  });
});

describe("applyDocumentAdjustments — vorzeichen-invariant (Storno/Gutschrift)", () => {
  const negativeBuckets = [
    { key: "S:19", taxRate: 19, taxCategory: "S", netCents: -10000 },
    { key: "S:7", taxRate: 7, taxCategory: "S", netCents: -10000 },
  ];

  it("10 % Rabatt auf Gutschrift -10000/-10000 -> allowance -1000/-1000, adjustedNet -9000/-9000", () => {
    const result = applyDocumentAdjustments(negativeBuckets, { discountPermille: 100 });
    expect(result[0].allowanceCents).toBe(-1000);
    expect(result[1].allowanceCents).toBe(-1000);
    expect(result[0].adjustedNetCents).toBe(-9000);
    expect(result[1].adjustedNetCents).toBe(-9000);
  });

  it("computeTaxBreakdown auf Gutschrift mit 10 % Rabatt -> Steuer -1710/-630, brutto -20340", () => {
    const t = computeTaxBreakdown(
      [
        { lineNetCents: -10000, taxRate: 19, taxCategory: "S" },
        { lineNetCents: -10000, taxRate: 7, taxCategory: "S" },
      ],
      { discountPermille: 100 },
    );
    const b19 = t.breakdown.find((e) => e.taxRate === 19)!;
    const b7 = t.breakdown.find((e) => e.taxRate === 7)!;
    expect(b19.taxCents).toBe(-1710);
    expect(b7.taxCents).toBe(-630);
    expect(t.grossTotalCents).toBe(-20340);
  });

  it("Festbetragsrabatt 1500 auf negative Buckets (-30000/-10000) -> -1125/-375", () => {
    const result = applyDocumentAdjustments(
      [
        { key: "S:19", taxRate: 19, taxCategory: "S", netCents: -30000 },
        { key: "S:7", taxRate: 7, taxCategory: "S", netCents: -10000 },
      ],
      { discountCents: 1500 },
    );
    expect(result[0].allowanceCents).toBe(-1125);
    expect(result[1].allowanceCents).toBe(-375);
  });

  it("5 % Aufschlag auf Gutschrift -10000 (ohne Rabatt) -> -450", () => {
    const result = applyDocumentAdjustments(
      [{ key: "S:19", taxRate: 19, taxCategory: "S", netCents: -10000 }],
      { chargePermille: 50 },
    );
    expect(result[0].chargeCents).toBe(-500);
    expect(result[0].adjustedNetCents).toBe(-10500);
  });

  it("gemischte Vorzeichen mit Anpassung wirft PricingError", () => {
    expect(() =>
      applyDocumentAdjustments(
        [
          { key: "S:19", taxRate: 19, taxCategory: "S", netCents: 10000 },
          { key: "S:7", taxRate: 7, taxCategory: "S", netCents: -10000 },
        ],
        { discountPermille: 100 },
      ),
    ).toThrow(PricingError);
  });

  it("gemischte Vorzeichen ohne Anpassung (total 0) bleibt erlaubt", () => {
    const result = applyDocumentAdjustments(
      [
        { key: "S:19", taxRate: 19, taxCategory: "S", netCents: 10000 },
        { key: "S:7", taxRate: 7, taxCategory: "S", netCents: -10000 },
      ],
      {},
    );
    expect(result[0].adjustedNetCents).toBe(10000);
    expect(result[1].adjustedNetCents).toBe(-10000);
  });

  it("Rabatt > |Netto| auf Gutschrift wirft PricingError mit sprechender Meldung", () => {
    expect(() =>
      applyDocumentAdjustments(
        [{ key: "S:19", taxRate: 19, taxCategory: "S", netCents: -1000 }],
        { discountCents: 2000 },
      ),
    ).toThrow(/Storno\/Gutschrift/);
  });
});
