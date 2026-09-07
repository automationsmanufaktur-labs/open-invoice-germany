/**
 * Phase 6, Task 3 — Cron-/Scheduler-Routen: CRON_SECRET-Schutz (analog run-recurring) und
 * Session-Schutz von /api/scheduler/run und /api/scheduler/runs.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const sessionStore: { userId: string | null } = vi.hoisted(() => ({ userId: null }));

vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => sessionStore.userId,
}));

import { GET as cronDunningGet } from "@/app/api/cron/run-dunning/route";
import { GET as cronAllGet } from "@/app/api/cron/run-all/route";
import { GET as cronRecurringGet } from "@/app/api/cron/run-recurring/route";
import { POST as schedulerRunPost } from "@/app/api/scheduler/run/route";
import { GET as schedulerRunsGet } from "@/app/api/scheduler/runs/route";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  sessionStore.userId = null;
});

describe("Cron-Routen: CRON_SECRET-Schutz", () => {
  it("run-dunning: 401 ohne Secret, wenn CRON_SECRET gesetzt ist", async () => {
    process.env.CRON_SECRET = "geheim";
    const res = await cronDunningGet(new Request("http://localhost/api/cron/run-dunning"));
    expect(res.status).toBe(401);
  });

  it("run-all: 401 ohne Secret, wenn CRON_SECRET gesetzt ist", async () => {
    process.env.CRON_SECRET = "geheim";
    const res = await cronAllGet(new Request("http://localhost/api/cron/run-all"));
    expect(res.status).toBe(401);
  });

  it("run-dunning: 200 mit korrektem Secret", async () => {
    process.env.CRON_SECRET = "geheim";
    const res = await cronDunningGet(new Request("http://localhost/api/cron/run-dunning", { headers: { authorization: "Bearer geheim" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // B3 (Fix-Welle): fail-closed statt "erlaubt, wenn kein Secret konfiguriert ist" — ein
  // Deployment ohne gesetztes CRON_SECRET darf die Route nicht anonym erreichbar lassen
  // (Mahn-/Abo-Versand). Alle drei Cron-Routen teilen sich `checkCronAuth`.
  it("run-dunning: 503 ohne gesetztes CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronDunningGet(new Request("http://localhost/api/cron/run-dunning"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("CRON_SECRET nicht gesetzt");
  });

  it("run-all: 503 ohne gesetztes CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronAllGet(new Request("http://localhost/api/cron/run-all"));
    expect(res.status).toBe(503);
  });

  it("run-recurring: 503 ohne gesetztes CRON_SECRET, 401 mit falschem, 200 mit korrektem Secret", async () => {
    delete process.env.CRON_SECRET;
    const resUnset = await cronRecurringGet(new Request("http://localhost/api/cron/run-recurring"));
    expect(resUnset.status).toBe(503);

    process.env.CRON_SECRET = "geheim";
    const resWrong = await cronRecurringGet(new Request("http://localhost/api/cron/run-recurring", { headers: { authorization: "Bearer falsch" } }));
    expect(resWrong.status).toBe(401);

    const resOk = await cronRecurringGet(new Request("http://localhost/api/cron/run-recurring", { headers: { authorization: "Bearer geheim" } }));
    expect(resOk.status).toBe(200);
    const body = await resOk.json();
    expect(body.ok).toBe(true);
  });
});

describe("Scheduler-Routen: Session-Schutz", () => {
  it("POST /api/scheduler/run: 401 ohne Session", async () => {
    sessionStore.userId = null;
    const res = await schedulerRunPost(new Request("http://localhost/api/scheduler/run", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("POST /api/scheduler/run: 200/207 mit Session", async () => {
    sessionStore.userId = "user-1";
    const res = await schedulerRunPost(new Request("http://localhost/api/scheduler/run", { method: "POST" }));
    expect([200, 207]).toContain(res.status);
  });

  it("GET /api/scheduler/runs: 401 ohne Session", async () => {
    sessionStore.userId = null;
    const res = await schedulerRunsGet();
    expect(res.status).toBe(401);
  });

  it("GET /api/scheduler/runs: 200 mit Session, liefert Array", async () => {
    sessionStore.userId = "user-1";
    const res = await schedulerRunsGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.runs)).toBe(true);
  });
});
