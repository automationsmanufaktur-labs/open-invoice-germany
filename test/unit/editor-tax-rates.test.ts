/** Phase 12c, Task 6 — Editor-Optionen und Clamping aus der Org-Liste. */
import { describe, it, expect } from "vitest";
import { taxRateOptions, FALLBACK_TAX_RATES } from "@/lib/editor/constants";
import { clampTaxRate } from "@/lib/editor/draft";

describe("taxRateOptions", () => {
  it("erzeugt absteigende Optionen mit Prozentbeschriftung", () => {
    expect(taxRateOptions([0, 7, 19])).toEqual([
      { value: 19, label: "19%" },
      { value: 7, label: "7%" },
      { value: 0, label: "0%" },
    ]);
  });
  it("kommt mit einer erweiterten Liste zurecht", () => {
    expect(taxRateOptions([0, 7, 10, 19]).map((o) => o.value)).toEqual([19, 10, 7, 0]);
  });
  it("faellt auf [19,7,0] zurueck, wenn die Liste leer ankommt", () => {
    expect(taxRateOptions([]).map((o) => o.value)).toEqual([...FALLBACK_TAX_RATES]);
  });
  it("M4 (Fix-Welle): 0% bleibt immer eine Option, auch wenn die Org-Liste sie nicht enthaelt", () => {
    // assertAllowedTaxRates (domain/settings/tax-rates.ts) laesst 0% domainweit IMMER zu
    // (Gliederungszeilen, Nullsatz-Schemata) — die Auswahl darf sie deshalb nie verlieren.
    expect(taxRateOptions([19, 5]).map((o) => o.value)).toEqual([19, 5, 0]);
  });
});

describe("clampTaxRate", () => {
  it("laesst freigegebene Saetze durch", () => {
    expect(clampTaxRate(10, [0, 7, 10, 19])).toBe(10);
  });
  it("faellt auf den hoechsten freigegebenen Satz zurueck, wenn der Wert unbekannt ist", () => {
    expect(clampTaxRate(10, [0, 7, 19])).toBe(19);
    expect(clampTaxRate(Number.NaN, [0, 7, 19])).toBe(19);
  });
  it("ohne Liste gilt weiterhin 19/7/0", () => {
    expect(clampTaxRate(7, [])).toBe(7);
    expect(clampTaxRate(10, [])).toBe(19);
  });
});
