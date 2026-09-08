/**
 * Phase 12d, Task 4 — Retention im bestehenden Cleanup-Job. Eigenes Jahr 2083
 * (Testjahr-Konvention), kein Rechnungsbezug.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { saveApiSettings } from "@/domain/api-log/settings";
import { runCleanupJob } from "@/domain/scheduler/cleanup";

const NOW = new Date("2083-06-15T10:00:00.000Z");
let orgId: string;
let otherOrgId: string;

async function makeRow(org: string, createdAt: Date, status = 200) {
  return dbInternal.apiRequestLog.create({
    data: { orgId: org, apiKeyId: null, requestId: `r-${org}-${createdAt.getTime()}-${Math.random()}`, method: "GET", path: "/api/v1/Invoice", status, durationMs: 5, createdAt },
  });
}

beforeAll(async () => {
  const a = await dbInternal.organization.create({ data: { legalName: "Retention A GmbH", addressLine1: "A 1", postalCode: "10115", city: "Berlin" } });
  const b = await dbInternal.organization.create({ data: { legalName: "Retention B GmbH", addressLine1: "B 1", postalCode: "10115", city: "Berlin" } });
  orgId = a.id;
  otherOrgId = b.id;
});

describe("Retention des Anfrageprotokolls", () => {
  it("loescht Zeilen aelter als retentionDays, laesst juengere und fremde Organisationen stehen", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: false, retentionDays: 7, maxRows: 2000 });
    const old = await makeRow(orgId, new Date(NOW.getTime() - 8 * 24 * 3600 * 1000));
    const fresh = await makeRow(orgId, new Date(NOW.getTime() - 1 * 24 * 3600 * 1000));
    const foreign = await makeRow(otherOrgId, new Date(NOW.getTime() - 2 * 24 * 3600 * 1000));
    const result = await runCleanupJob(NOW);
    expect(result.apiRequestLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(await dbInternal.apiRequestLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await dbInternal.apiRequestLog.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await dbInternal.apiRequestLog.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  it("kuerzt auf maxRows und behaelt die NEUESTEN", async () => {
    await dbInternal.apiRequestLog.deleteMany({ where: { orgId } });
    await saveApiSettings(orgId, { logRequests: true, logBodies: false, retentionDays: 90, maxRows: 100 });
    for (let i = 0; i < 250; i++) await makeRow(orgId, new Date(NOW.getTime() - i * 60_000));
    await runCleanupJob(NOW);
    const rows = await dbInternal.apiRequestLog.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(rows).toHaveLength(100);
    expect(rows[0].createdAt.getTime()).toBe(NOW.getTime());
  });

  it("ohne ApiSettings-Zeile gelten 7 Tage / 2000 Zeilen", async () => {
    const noSettingsOrg = await dbInternal.organization.create({ data: { legalName: "Ohne Settings GmbH", addressLine1: "C 1", postalCode: "10115", city: "Berlin" } });
    const old = await makeRow(noSettingsOrg.id, new Date(NOW.getTime() - 8 * 24 * 3600 * 1000));
    await runCleanupJob(NOW);
    expect(await dbInternal.apiRequestLog.findUnique({ where: { id: old.id } })).toBeNull();
  });
});
