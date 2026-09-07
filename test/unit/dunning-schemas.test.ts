import { describe, it, expect } from "vitest";
import {
  dunningStageInputSchema,
  dunningStagesReorderSchema,
  dunningSettingsInputSchema,
  dunningStateInputSchema,
} from "@/schemas";

const baseStageFields = {
  name: "Zahlungserinnerung",
  daysAfterDue: 3,
  newDueDays: 14,
  feeCents: 0,
  calculateInterest: false,
  includeB2BFlatFee: false,
};

describe("dunningStageInputSchema — feeCents nur ab Stufe 2 (COMPLIANCE §12)", () => {
  it("order 0 mit feeCents > 0 wird abgelehnt", () => {
    const r = dunningStageInputSchema.safeParse({ ...baseStageFields, order: 0, feeCents: 500 });
    expect(r.success).toBe(false);
  });

  it("order 1 mit feeCents > 0 wird abgelehnt", () => {
    const r = dunningStageInputSchema.safeParse({ ...baseStageFields, order: 1, feeCents: 500 });
    expect(r.success).toBe(false);
  });

  it("order 2 mit feeCents > 0 ist erlaubt", () => {
    const r = dunningStageInputSchema.safeParse({ ...baseStageFields, order: 2, feeCents: 500 });
    expect(r.success).toBe(true);
  });

  it("order 0 mit feeCents = 0 ist erlaubt", () => {
    const r = dunningStageInputSchema.safeParse({ ...baseStageFields, order: 0, feeCents: 0 });
    expect(r.success).toBe(true);
  });

  it("newDueDays ausserhalb 1..365 wird abgelehnt", () => {
    expect(dunningStageInputSchema.safeParse({ ...baseStageFields, order: 0, newDueDays: 0 }).success).toBe(false);
    expect(dunningStageInputSchema.safeParse({ ...baseStageFields, order: 0, newDueDays: 366 }).success).toBe(false);
  });

  it("autoSend/enabled defaulten korrekt", () => {
    const r = dunningStageInputSchema.parse({ ...baseStageFields, order: 0 });
    expect(r.autoSend).toBe(false);
    expect(r.enabled).toBe(true);
  });
});

describe("dunningStagesReorderSchema", () => {
  it("leeres Array wird abgelehnt", () => {
    expect(dunningStagesReorderSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it("Array mit mind. einer Id ist gueltig", () => {
    expect(dunningStagesReorderSchema.safeParse({ ids: ["a", "b", "c"] }).success).toBe(true);
  });
});

describe("dunningSettingsInputSchema", () => {
  it("Defaults entsprechen §26 (autoCreate an, autoSend aus)", () => {
    const r = dunningSettingsInputSchema.parse({});
    expect(r.autoCreate).toBe(true);
    expect(r.autoSend).toBe(false);
    expect(r.baseInterestRateBp).toBe(127);
    expect(r.gracePeriodDays).toBe(0);
  });

  it("baseInterestRateBp ausserhalb 0..2000 wird abgelehnt", () => {
    expect(dunningSettingsInputSchema.safeParse({ baseInterestRateBp: -1 }).success).toBe(false);
    expect(dunningSettingsInputSchema.safeParse({ baseInterestRateBp: 2001 }).success).toBe(false);
    expect(dunningSettingsInputSchema.safeParse({ baseInterestRateBp: 2000 }).success).toBe(true);
  });

  it("gracePeriodDays ausserhalb 0..90 wird abgelehnt", () => {
    expect(dunningSettingsInputSchema.safeParse({ gracePeriodDays: 91 }).success).toBe(false);
    expect(dunningSettingsInputSchema.safeParse({ gracePeriodDays: 90 }).success).toBe(true);
  });

  it("baseRateValidFrom akzeptiert ISO-Datum oder null", () => {
    expect(dunningSettingsInputSchema.safeParse({ baseRateValidFrom: "2026-01-01" }).success).toBe(true);
    expect(dunningSettingsInputSchema.safeParse({ baseRateValidFrom: null }).success).toBe(true);
    expect(dunningSettingsInputSchema.safeParse({ baseRateValidFrom: "not-a-date" }).success).toBe(false);
  });
});

describe("dunningStateInputSchema", () => {
  it("state=PAUSED mit pausedUntil ist gueltig", () => {
    expect(dunningStateInputSchema.safeParse({ state: "PAUSED", pausedUntil: "2026-12-01" }).success).toBe(true);
  });

  it("state=ACTIVE mit pausedUntil wird abgelehnt", () => {
    expect(dunningStateInputSchema.safeParse({ state: "ACTIVE", pausedUntil: "2026-12-01" }).success).toBe(false);
  });

  it("state=STOPPED mit pausedUntil wird abgelehnt", () => {
    expect(dunningStateInputSchema.safeParse({ state: "STOPPED", pausedUntil: "2026-12-01" }).success).toBe(false);
  });

  it("state=ACTIVE ohne pausedUntil ist gueltig", () => {
    expect(dunningStateInputSchema.safeParse({ state: "ACTIVE" }).success).toBe(true);
  });

  // S1 (Fix-Welle): PAUSED ohne Datum war zuvor ein stiller No-Op (create.ts sah es als
  // sofort abgelaufen und mahnte trotzdem) — pausedUntil ist jetzt Pflicht und muss in
  // der Zukunft liegen.
  it("state=PAUSED ohne pausedUntil wird abgelehnt", () => {
    expect(dunningStateInputSchema.safeParse({ state: "PAUSED" }).success).toBe(false);
  });

  it("state=PAUSED mit pausedUntil=heute oder in der Vergangenheit wird abgelehnt", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(dunningStateInputSchema.safeParse({ state: "PAUSED", pausedUntil: today }).success).toBe(false);
    expect(dunningStateInputSchema.safeParse({ state: "PAUSED", pausedUntil: "2020-01-01" }).success).toBe(false);
  });

  it("state=PAUSED mit pausedUntil in der Zukunft ist gueltig", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(dunningStateInputSchema.safeParse({ state: "PAUSED", pausedUntil: future }).success).toBe(true);
  });

  it("note laenger als 500 Zeichen wird abgelehnt", () => {
    expect(dunningStateInputSchema.safeParse({ state: "ACTIVE", note: "x".repeat(501) }).success).toBe(false);
    expect(dunningStateInputSchema.safeParse({ state: "ACTIVE", note: "x".repeat(500) }).success).toBe(true);
  });

  it("unbekannter state wird abgelehnt", () => {
    expect(dunningStateInputSchema.safeParse({ state: "FOO" }).success).toBe(false);
  });
});
