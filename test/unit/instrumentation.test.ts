/**
 * Nit (Fix-Welle, Phase 6) — `src/instrumentation.ts`: SCHEDULER_ENABLED ist Default AN
 * (Opt-out). Vorher deaktivierte nur der exakte String "false"; "0"/"no"/"off" starteten
 * den Loop trotzdem, entgegen dem .env.example-Kommentar "Default an" fuer einen
 * Opt-out-Schalter. `startScheduler` wird gemockt — dieser Test prueft nur, ob/mit
 * welchen Minuten register() ihn aufruft, nicht die Loop-Logik selbst (dafuer
 * test/unit/scheduler-loop.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const startSchedulerMock = vi.hoisted(() => vi.fn());
vi.mock("@/domain/scheduler/loop", () => ({
  startScheduler: startSchedulerMock,
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  startSchedulerMock.mockClear();
  process.env.NEXT_RUNTIME = "nodejs";
  delete process.env.SCHEDULER_ENABLED;
  delete process.env.SCHEDULER_INTERVAL_MINUTES;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("register() (src/instrumentation.ts)", () => {
  it("nicht NEXT_RUNTIME=nodejs -> startScheduler wird nicht aufgerufen", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await register();
    expect(startSchedulerMock).not.toHaveBeenCalled();
  });

  it("SCHEDULER_ENABLED unset -> Default AN, startScheduler wird aufgerufen", async () => {
    const { register } = await import("@/instrumentation");
    await register();
    expect(startSchedulerMock).toHaveBeenCalledTimes(1);
  });

  for (const off of ["false", "0", "no", "off", "FALSE", "Off"]) {
    it(`SCHEDULER_ENABLED=${off} deaktiviert den Loop`, async () => {
      process.env.SCHEDULER_ENABLED = off;
      const { register } = await import("@/instrumentation");
      await register();
      expect(startSchedulerMock).not.toHaveBeenCalled();
    });
  }

  it("SCHEDULER_ENABLED=true startet den Loop", async () => {
    process.env.SCHEDULER_ENABLED = "true";
    const { register } = await import("@/instrumentation");
    await register();
    expect(startSchedulerMock).toHaveBeenCalledTimes(1);
  });
});
