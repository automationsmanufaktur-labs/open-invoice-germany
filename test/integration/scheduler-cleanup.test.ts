/**
 * Fix-Welle Phase 10 (Should-fix 7) — Retention-Job "cleanup"
 * (src/domain/scheduler/cleanup.ts): loescht WebhookDelivery (DELIVERED/DEAD) aelter
 * als 90 Tage und ApiIdempotency aelter als 24h. Eigenes Jahr 2078 (Testjahr-Konvention,
 * plan-header.md) — kein Rechnungsbezug in diesem File.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { runCleanupJob, WEBHOOK_DELIVERY_RETENTION_MS, API_IDEMPOTENCY_RETENTION_MS } from "@/domain/scheduler/cleanup";
import { runScheduledJobs } from "@/domain/scheduler/runner";

const NOW = new Date("2078-01-15T10:00:00.000Z");

let orgId: string;
let endpointId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Cleanup Test GmbH", addressLine1: "Weg 1", postalCode: "10117", city: "Berlin", vatId: "DE333333333", taxNumber: "33/333/33333" },
  });
  orgId = org.id;
  const endpoint = await dbInternal.webhookEndpoint.create({
    data: { orgId, url: "https://93.184.216.50/hook", secretEnc: "v1:x:x:x", eventsJson: '["invoice.finalized"]' },
  });
  endpointId = endpoint.id;
});

async function makeDelivery(status: string, createdAt: Date) {
  return dbInternal.webhookDelivery.create({
    data: { orgId, endpointId, event: "invoice.finalized", objectName: "Invoice", objectId: `d-${status}-${createdAt.getTime()}`, dataJson: "{}", status, createdAt, nextAttemptAt: createdAt },
  });
}

async function makeIdempotency(key: string, createdAt: Date) {
  return dbInternal.apiIdempotency.create({
    data: { orgId, key, requestHash: "hash", status: "DONE", responseJson: "{}", statusCode: 200, createdAt },
  });
}

describe("runCleanupJob", () => {
  it("loescht WebhookDelivery (DELIVERED/DEAD) aelter als 90 Tage, laesst juengere und PENDING/FAILED unangetastet", async () => {
    const old = new Date(NOW.getTime() - WEBHOOK_DELIVERY_RETENTION_MS - 1000);
    const recent = new Date(NOW.getTime() - 1000);

    const oldDelivered = await makeDelivery("DELIVERED", old);
    const oldDead = await makeDelivery("DEAD", old);
    const recentDelivered = await makeDelivery("DELIVERED", recent);
    const oldPending = await makeDelivery("PENDING", old);
    const oldFailed = await makeDelivery("FAILED", old);

    // Kein exakter globaler Zaehlwert: der Job filtert bewusst OHNE orgId (Wartungsjob
    // ueber die gesamte Tabelle) — andere, parallel in derselben Test-DB laufende Dateien
    // (z. B. webhooks.test.ts) koennen ebenfalls aeltere DELIVERED/DEAD-Zeilen anlegen.
    // Die eigentliche Zusicherung sind die gezielten Vorher/Nachher-Pruefungen unten.
    const result = await runCleanupJob(NOW);
    expect(result.webhookDeliveriesDeleted).toBeGreaterThanOrEqual(2);

    expect(await dbInternal.webhookDelivery.findUnique({ where: { id: oldDelivered.id } })).toBeNull();
    expect(await dbInternal.webhookDelivery.findUnique({ where: { id: oldDead.id } })).toBeNull();
    expect(await dbInternal.webhookDelivery.findUnique({ where: { id: recentDelivered.id } })).not.toBeNull();
    expect(await dbInternal.webhookDelivery.findUnique({ where: { id: oldPending.id } })).not.toBeNull();
    expect(await dbInternal.webhookDelivery.findUnique({ where: { id: oldFailed.id } })).not.toBeNull();
  });

  it("loescht ApiIdempotency aelter als 24h, laesst juengere unangetastet", async () => {
    const old = new Date(NOW.getTime() - API_IDEMPOTENCY_RETENTION_MS - 1000);
    const recent = new Date(NOW.getTime() - 1000);

    const oldRow = await makeIdempotency("cleanup-old", old);
    const recentRow = await makeIdempotency("cleanup-recent", recent);

    const result = await runCleanupJob(NOW);
    expect(result.apiIdempotencyDeleted).toBeGreaterThanOrEqual(1);

    expect(await dbInternal.apiIdempotency.findUnique({ where: { id: oldRow.id } })).toBeNull();
    expect(await dbInternal.apiIdempotency.findUnique({ where: { id: recentRow.id } })).not.toBeNull();
  });

  it("ist Teil der Scheduler-Jobreihenfolge als letzter Job (nach webhooks)", async () => {
    const results = await runScheduledJobs({ trigger: "MANUAL", now: NOW, jobs: ["cleanup"] });
    expect(results.map((r) => r.job)).toEqual(["cleanup"]);
    expect(results[0].ok).toBe(true);
  });
});
