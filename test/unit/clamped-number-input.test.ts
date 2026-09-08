import { describe, it, expect } from "vitest";
import { parseClampedNumberInput } from "@/lib/forms/clamped-number-input";

describe("parseClampedNumberInput (Fix-Welle 12a, M6 Fix 2 — Blur-Parse-Semantik)", () => {
  it("geleertes Feld -> vorheriger Wert (nicht min)", () => {
    expect(parseClampedNumberInput("", 15, 40, 22)).toBe(22);
  });
  it("nur Leerraum -> vorheriger Wert", () => {
    expect(parseClampedNumberInput("   ", 15, 40, 22)).toBe(22);
  });
  it("nicht-numerischer Rest -> vorheriger Wert", () => {
    expect(parseClampedNumberInput("-", 15, 40, 22)).toBe(22);
  });
  it("gueltiger Wert innerhalb der Spanne bleibt unveraendert (18 bleibt 18, nicht min-dann-max)", () => {
    expect(parseClampedNumberInput("18", 15, 40, 22)).toBe(18);
  });
  it("Wert oberhalb max wird auf max geklemmt", () => {
    expect(parseClampedNumberInput("158", 15, 40, 22)).toBe(40);
  });
  it("Wert unterhalb min wird auf min geklemmt", () => {
    expect(parseClampedNumberInput("5", 15, 40, 22)).toBe(15);
  });
  it("Logobreite-Spanne (10-140 mm)", () => {
    expect(parseClampedNumberInput("", 10, 140, 40)).toBe(40);
    expect(parseClampedNumberInput("200", 10, 140, 40)).toBe(140);
  });
});
