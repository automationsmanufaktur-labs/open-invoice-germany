import { describe, it, expect } from "vitest";
import {
  parseEuroToCents,
  formatCents,
  formatCentsShort,
  roundHalfUp,
  parseQuantityToMilli,
} from "@/lib/money";

describe("money", () => {
  it("rundet kaufmännisch (half-up, symmetrisch)", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });

  it("parseEuroToCents akzeptiert DE- und EN-Format", () => {
    expect(parseEuroToCents("1.234,56")).toBe(123456);
    expect(parseEuroToCents("1234.56")).toBe(123456);
    expect(parseEuroToCents("19,99 €")).toBe(1999);
  });

  it("parseQuantityToMilli akzeptiert beide Dezimalformate", () => {
    expect(parseQuantityToMilli("2,5")).toBe(2500);
    expect(parseQuantityToMilli("2.5")).toBe(2500); // Dezimalpunkt darf nicht als Tausender gelesen werden
    expect(parseQuantityToMilli("1")).toBe(1000);
    expect(parseQuantityToMilli("1.234,5")).toBe(1234500);
  });

  it("formatCents als de-DE/EUR", () => {
    expect(formatCents(123456)).toMatch(/1\.234,56/);
  });

  it("formatCentsShort (Fix I5: BarChart-y-Achse) bleibt unter 1.000 € beim vollen Format", () => {
    expect(formatCentsShort(50000)).toMatch(/500,00/);
    expect(formatCentsShort(99999)).toMatch(/999,99/);
  });

  it("formatCentsShort kuerzt ab 1.000 € auf 'x,y k€'", () => {
    expect(formatCentsShort(120000)).toBe("1,2 k€");
    expect(formatCentsShort(100000)).toBe("1,0 k€");
    expect(formatCentsShort(1234567)).toBe("12,3 k€");
  });

  it("formatCentsShort behaelt das Vorzeichen", () => {
    expect(formatCentsShort(-120000)).toBe("-1,2 k€");
    expect(formatCentsShort(-50000)).toMatch(/-500,00/);
  });
});
