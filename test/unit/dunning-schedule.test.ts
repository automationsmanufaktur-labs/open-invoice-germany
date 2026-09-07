import { describe, it, expect } from "vitest";
import { dunningScheduleFor, latestDunning, type StageLike, type DunningLike } from "@/domain/dunning/schedule";

const STAGES: StageLike[] = [
  { order: 0, enabled: true, daysAfterDue: 3 },
  { order: 1, enabled: true, daysAfterDue: 10 },
  { order: 2, enabled: false, daysAfterDue: 10 },
  { order: 3, enabled: true, daysAfterDue: 7 },
];

describe("dunningScheduleFor (Phase 6, Task 2)", () => {
  it("erste Mahnung: Basis ist die Rechnungsfaelligkeit, Karenzfrist zaehlt mit", () => {
    const invoiceDueDate = new Date("2050-01-01T00:00:00.000Z");
    const s = dunningScheduleFor({
      invoiceDueDate,
      lastDunning: null,
      stages: STAGES,
      gracePeriodDays: 2,
      now: new Date("2050-01-06T00:00:00.000Z"), // Faellig +3+2=5 Tage -> 06.01.
    });
    expect(s.nextStage?.order).toBe(0);
    expect(s.dueAt?.toISOString()).toBe("2050-01-06T00:00:00.000Z");
    expect(s.isDue).toBe(true);
  });

  it("noch nicht faellig -> isDue false", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: null,
      stages: STAGES,
      gracePeriodDays: 0,
      now: new Date("2050-01-02T00:00:00.000Z"),
    });
    expect(s.isDue).toBe(false);
  });

  it("Karenzfrist zaehlt NICHT bei Folgestufen (order > 0)", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: { order: 0, dueDate: new Date("2050-01-15T00:00:00.000Z"), sentAt: new Date("2050-01-04T00:00:00.000Z") },
      stages: STAGES,
      gracePeriodDays: 5,
      now: new Date("2050-01-25T00:00:00.000Z"), // Basis (dueDate der Stufe 0) + 10 Tage = 25.01., ohne Karenz
    });
    expect(s.nextStage?.order).toBe(1);
    expect(s.dueAt?.toISOString()).toBe("2050-01-25T00:00:00.000Z");
    expect(s.isDue).toBe(true);
  });

  it("Basis der Folgestufe ist dueDate der letzten Mahnung, Fallback sentAt wenn dueDate null", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: { order: 0, dueDate: null, sentAt: new Date("2050-01-10T00:00:00.000Z") },
      stages: STAGES,
      gracePeriodDays: 0,
      now: new Date("2050-01-20T00:00:00.000Z"),
    });
    expect(s.dueAt?.toISOString()).toBe("2050-01-20T00:00:00.000Z"); // 10.01 + 10 Tage
  });

  it("deaktivierte Stufe (order 2) wird uebersprungen -> naechste ist order 3", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: { order: 1, dueDate: new Date("2050-02-01T00:00:00.000Z"), sentAt: new Date("2050-02-01T00:00:00.000Z") },
      stages: STAGES,
      gracePeriodDays: 0,
      now: new Date("2050-02-08T00:00:00.000Z"),
    });
    expect(s.nextStage?.order).toBe(3);
    expect(s.dueAt?.toISOString()).toBe("2050-02-08T00:00:00.000Z"); // 01.02 + 7 Tage
  });

  it("keine weitere Stufe -> nextStage null, dueAt null, isDue false", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: { order: 3, dueDate: new Date("2050-03-01T00:00:00.000Z"), sentAt: new Date("2050-03-01T00:00:00.000Z") },
      stages: STAGES,
      gracePeriodDays: 0,
      now: new Date("2050-04-01T00:00:00.000Z"),
    });
    expect(s.nextStage).toBeNull();
    expect(s.dueAt).toBeNull();
    expect(s.isDue).toBe(false);
  });

  it("daysOverdue zaehlt ab Rechnungsfaelligkeit, unabhaengig von lastDunning", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: { order: 0, dueDate: new Date("2050-01-20T00:00:00.000Z"), sentAt: new Date("2050-01-04T00:00:00.000Z") },
      stages: STAGES,
      gracePeriodDays: 0,
      now: new Date("2050-02-01T00:00:00.000Z"),
    });
    expect(s.daysOverdue).toBe(31);
  });

  it("isDue vergleicht tagesgenau (UTC-Datum) — Uhrzeit von now spielt keine Rolle", () => {
    const s = dunningScheduleFor({
      invoiceDueDate: new Date("2050-01-01T00:00:00.000Z"),
      lastDunning: null,
      stages: STAGES,
      gracePeriodDays: 0,
      now: new Date("2050-01-04T23:59:00.000Z"), // faellig am 04.01. (01.01 + 3 Tage), spaet abends
    });
    expect(s.isDue).toBe(true);
  });
});

// Nit (Fix-Welle): "letzte Mahnung" wurde an drei Stellen unterschiedlich bestimmt
// (create.ts, auto.ts: createdAt desc + take 1; Rechnungsseite: orderBy level asc, letztes
// Element) — nach einem Reorder der Mahnstufen (S3) nicht mehr aequivalent. Ein Helper.
describe("latestDunning (Nit, Fix-Welle)", () => {
  function d(createdAt: string, level: number, order?: number): DunningLike {
    return { createdAt: new Date(createdAt), level, stage: order === undefined ? null : { order } };
  }

  it("leere Liste -> null", () => {
    expect(latestDunning([])).toBeNull();
  });

  it("waehlt das juengste createdAt, unabhaengig von order/Array-Position", () => {
    const older = d("2050-01-01T00:00:00.000Z", 2, 2);
    const newer = d("2050-01-10T00:00:00.000Z", 0, 0);
    expect(latestDunning([older, newer])).toBe(newer);
    expect(latestDunning([newer, older])).toBe(newer); // Reihenfolge im Array egal
  });

  it("Tiebreak bei gleichem createdAt: hoehere Stufenordnung (stage.order, Fallback level)", () => {
    const low = d("2050-01-01T00:00:00.000Z", 1, 1);
    const high = d("2050-01-01T00:00:00.000Z", 3, 3);
    expect(latestDunning([low, high])).toBe(high);
    expect(latestDunning([high, low])).toBe(high);
  });

  it("ohne stage (Altmahnung) faellt der Tiebreak auf level zurueck", () => {
    const low = d("2050-01-01T00:00:00.000Z", 0);
    const high = d("2050-01-01T00:00:00.000Z", 2);
    expect(latestDunning([low, high])).toBe(high);
  });
});
