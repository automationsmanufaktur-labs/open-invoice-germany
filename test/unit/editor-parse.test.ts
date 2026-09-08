import { describe, it, expect } from "vitest";
import { toCents, toMilli, toPermille, fromCents, fromMilli, fromPermille, permilleOrZero } from "@/lib/editor/parse";
describe("editor/parse", () => {
  it("Euro-Eingaben mit Komma/Punkt/Tausenderpunkt", () => {
    expect(toCents("12,50")).toBe(1250); expect(toCents("12.50")).toBe(1250); expect(toCents("1.234,56")).toBe(123456);
    expect(toCents("")).toBeNull(); expect(toCents("abc")).toBeNull(); expect(toCents("-3,10")).toBe(-310);
  });
  it("Mengen in Milli", () => { expect(toMilli("2")).toBe(2000); expect(toMilli("2,5")).toBe(2500); expect(toMilli("0")).toBe(0); expect(toMilli("x")).toBeNull(); });
  it("Prozent in Permille, Rueckformat", () => { expect(toPermille("10")).toBe(100); expect(toPermille("2,5")).toBe(25); expect(fromPermille(25)).toBe("2,5"); expect(fromCents(1250)).toBe("12,50"); expect(fromMilli(2500)).toBe("2,5"); expect(fromMilli(2000)).toBe("2"); });
  // Fix 1 (Task-1-Review): permilleOrZero klemmt auf 0..1000, statt wie toPermille
  // unbegrenzt/negativ zurueckzugeben — dieselbe Klemmung wie im Payload-Mapper.
  it("permilleOrZero klemmt auf 0..1000", () => {
    expect(permilleOrZero("150")).toBe(1000);
    expect(permilleOrZero("-5")).toBe(0);
  });
});
