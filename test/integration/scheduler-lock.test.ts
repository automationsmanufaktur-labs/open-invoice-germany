/**
 * Phase 6, Task 3, Fix Runde 1 — atomarer Lock (`SchedulerLock`, Unique-Constraint auf
 * `job`) statt der vorherigen, nicht-atomaren "findFirst dann create"-Praxis auf
 * `SchedulerRun` (Review-Befund: unter Postgres READ COMMITTED konnten zwei gleichzeitige
 * Laeufe beide die Lesepruefung passieren). Eigene Datei, weil hier `@/domain/scheduler/jobs`
 * gemockt wird (steuerbare Verzoegerung fuer den echten Nebenlaeufigkeits-Test) — das darf
 * die uebrigen Scheduler-Tests (`scheduler.test.ts`, echte Jobs) nicht beeinflussen.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

let releaseFirst: (() => void) | null = null;
let callCount = 0;
let failNextCall = false;

const jobsMock = vi.hoisted(() => ({
  dunning: vi.fn(),
  recurring: vi.fn(),
}));

vi.mock("@/domain/scheduler/jobs", () => ({ jobs: jobsMock }));

import { dbInternal } from "@/lib/db";
import { runScheduledJobs } from "@/domain/scheduler/runner";

beforeAll(() => {
  // Erster Aufruf des gemockten "dunning"-Jobs haengt, bis `releaseFirst()` gerufen wird --
  // simuliert einen laufenden Job, dessen Lock waehrenddessen fuer einen zweiten,
  // gleichzeitigen Lauf desselben Jobs (Promise.all) gehalten werden muss.
  jobsMock.dunning.mockImplementation(async () => {
    callCount += 1;
    if (failNextCall) {
      failNextCall = false;
      throw new Error("Job absichtlich fehlgeschlagen (Test)");
    }
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return { ok: true };
  });
  jobsMock.recurring.mockResolvedValue({ ok: true });
});

beforeEach(() => {
  callCount = 0;
  releaseFirst = null;
  failNextCall = false;
});

describe("Phase 6 — SchedulerLock (Fix Runde 1, atomarer Erwerb via Unique-Constraint)", () => {
  it("(a) echte Nebenlaeufigkeit: nur EIN gleichzeitiger Lauf fuehrt den Job aus, der andere meldet skipped:locked", async () => {
    const now = new Date("2051-07-01T10:00:00.000Z");

    const p1 = runScheduledJobs({ jobs: ["dunning"], trigger: "MANUAL", now });
    // Kurz warten, bis der erste Lauf den Lock sicher erworben hat (create() ist async),
    // dann den zweiten, tatsaechlich gleichzeitigen Lauf starten.
    await vi.waitFor(() => expect(callCount).toBe(1));
    const p2 = runScheduledJobs({ jobs: ["dunning"], trigger: "MANUAL", now });

    await vi.waitFor(async () => {
      const locked = await dbInternal.schedulerLock.findUnique({ where: { job: "dunning" } });
      expect(locked).not.toBeNull();
    });

    // Der zweite Lauf muss JETZT (waehrend der erste noch haengt) fertig sein --
    // er wurde vom Unique-Constraint (P2002) abgewiesen, nicht von einer Wartezeit.
    const [r2] = await Promise.all([p2]);
    expect(r2.find((r) => r.job === "dunning")!.summary.skipped).toBe("locked");

    releaseFirst?.();
    const [r1] = await Promise.all([p1]);
    expect(r1.find((r) => r.job === "dunning")!.ok).toBe(true);
    expect(r1.find((r) => r.job === "dunning")!.summary.skipped).toBeUndefined();

    expect(callCount).toBe(1); // Job-Funktion wurde nur EINMAL tatsaechlich ausgefuehrt.

    const remainingLock = await dbInternal.schedulerLock.findUnique({ where: { job: "dunning" } });
    expect(remainingLock).toBeNull(); // im finally freigegeben.
  });

  it("(b) Lock aelter als 30 Minuten wird uebernommen", async () => {
    const started = new Date("2051-07-02T09:00:00.000Z");
    const now = new Date("2051-07-02T09:31:00.000Z"); // 31 Min spaeter -> stale
    const run = await dbInternal.schedulerRun.create({ data: { job: "recurring", trigger: "SCHEDULER", status: "RUNNING", startedAt: started } });
    await dbInternal.schedulerLock.create({ data: { job: "recurring", runId: run.id, lockedAt: started } });

    const results = await runScheduledJobs({ jobs: ["recurring"], trigger: "MANUAL", now });
    const r = results.find((res) => res.job === "recurring")!;
    expect(r.ok).toBe(true);
    expect(r.summary.skipped).toBeUndefined();

    const oldRun = await dbInternal.schedulerRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(oldRun.status).toBe("FAILED");
    expect(oldRun.error).toBe("stale");
  });

  it("(c) Lock wird nach einem fehlschlagenden Job freigegeben -- naechster Lauf fuehrt aus", async () => {
    failNextCall = true;
    const now = new Date("2051-07-03T10:00:00.000Z");

    const r1 = await runScheduledJobs({ jobs: ["dunning"], trigger: "MANUAL", now });
    expect(r1.find((r) => r.job === "dunning")!.ok).toBe(false);

    const lockAfterFailure = await dbInternal.schedulerLock.findUnique({ where: { job: "dunning" } });
    expect(lockAfterFailure).toBeNull();

    // callCount==1 (der fehlgeschlagene Aufruf); zweiter Lauf haengt jetzt im "wartenden"
    // Zweig des Mocks -- fuer diesen Test reicht der Nachweis, dass er UEBERHAUPT startet
    // (Lock war frei, kein "skipped:locked").
    const p2 = runScheduledJobs({ jobs: ["dunning"], trigger: "MANUAL", now: new Date(now.getTime() + 1000) });
    await vi.waitFor(() => expect(callCount).toBe(2));
    releaseFirst?.();
    const r2 = await p2;
    expect(r2.find((r) => r.job === "dunning")!.summary.skipped).toBeUndefined();
  });
});
