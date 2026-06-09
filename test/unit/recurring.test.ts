import { describe, it, expect } from "vitest";
import { advanceDate, intervalLabel } from "@/lib/recurring";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("advanceDate (Abo-Stichtage)", () => {
  it("MONTHLY: + 1 Monat", () => {
    expect(iso(advanceDate(new Date("2026-01-15T09:00:00"), "MONTHLY"))).toBe("2026-02-15");
  });

  it("MONTHLY klemmt auf Monatsletzten (31.01. → 28.02.)", () => {
    expect(iso(advanceDate(new Date("2026-01-31T09:00:00"), "MONTHLY"))).toBe("2026-02-28");
  });

  it("QUARTERLY: + 3 Monate über Jahresgrenze", () => {
    expect(iso(advanceDate(new Date("2026-11-15T09:00:00"), "QUARTERLY"))).toBe("2027-02-15");
  });

  it("YEARLY: + 1 Jahr", () => {
    expect(iso(advanceDate(new Date("2026-06-01T09:00:00"), "YEARLY"))).toBe("2027-06-01");
  });

  it("WEEKLY: + 7 Tage", () => {
    expect(iso(advanceDate(new Date("2026-06-01T09:00:00"), "WEEKLY"))).toBe("2026-06-08");
  });

  it("intervalCount: alle 2 Monate", () => {
    expect(iso(advanceDate(new Date("2026-01-15T09:00:00"), "MONTHLY", 2))).toBe("2026-03-15");
  });

  it("anchorDay fixiert den Tag", () => {
    expect(iso(advanceDate(new Date("2026-01-15T09:00:00"), "MONTHLY", 1, 1))).toBe("2026-02-01");
  });

  it("Label spiegelt Rhythmus", () => {
    expect(intervalLabel("MONTHLY")).toBe("monatlich");
    expect(intervalLabel("MONTHLY", 2)).toBe("alle 2 Monate");
  });
});
