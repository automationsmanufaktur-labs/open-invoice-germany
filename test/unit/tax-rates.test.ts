/** Phase 12c, Task 5 — Steuersatz-Liste: Zod, Normalisierung, TaxRate-Lockerung. */
import { describe, it, expect } from "vitest";
import { taxRatesSchema, normalizeTaxRates, documentSettingsInputSchema } from "@/schemas/quote-share";
import { TaxRate } from "@/schemas";

describe("taxRatesSchema (Phase 12c)", () => {
  it("Default ist [19,7,0]", () => {
    expect(documentSettingsInputSchema.parse({}).taxRates).toEqual([19, 7, 0]);
  });
  it("1..10 Eintraege, 0..100, ganzzahlig", () => {
    for (const bad of [[], [19, 7, 0, 5, 10, 12, 13, 16, 20, 21, 22], [101], [-1], [5.5]]) {
      expect(taxRatesSchema.safeParse(bad).success).toBe(false);
    }
    expect(taxRatesSchema.parse([19, 7, 0])).toEqual([19, 7, 0]);
  });
  it("normalizeTaxRates dedupliziert und sortiert aufsteigend", () => {
    expect(normalizeTaxRates([19, 19, 7])).toEqual([7, 19]);
    expect(normalizeTaxRates([0, 19, 7])).toEqual([0, 7, 19]);
  });
});

describe("TaxRate ist keine Union mehr", () => {
  it("akzeptiert jeden ganzzahligen Satz 0..100", () => {
    for (const ok of [0, 7, 10, 19, 100]) expect(TaxRate.parse(ok)).toBe(ok);
    for (const bad of [-1, 101, 5.5]) expect(TaxRate.safeParse(bad).success).toBe(false);
  });
});
