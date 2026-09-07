/**
 * Retention-Job "cleanup" (Fix-Welle Phase 10, Should-fix 7) — loescht Zeilen, die sonst
 * unbegrenzt wachsen:
 *
 * - `WebhookDelivery` im Endzustand (DELIVERED/DEAD), aelter als 90 Tage (`createdAt`) —
 *   ein Datensatz je Ereignis x Endpunkt, jeweils mit vollem Serializer-Schnappschuss in
 *   `dataJson` (final-review-findings.md #7).
 * - `ApiIdempotency`, aelter als 24h — das Ablaufverhalten in src/api/idempotency.ts ist
 *   rein lazy (eine Zeile wird nur geloescht, wenn GENAU IHR Schluessel erneut verwendet
 *   wird); ohne diesen Job bleibt jede einmal benutzte Idempotency-Key-Zeile fuer immer
 *   stehen, sobald sie nicht zufaellig wiederverwendet wird.
 *
 * Laeuft als LETZTER Job (JOB_ORDER, src/domain/scheduler/runner.ts, nach "webhooks") —
 * raeumt damit nie eine Zeile weg, die derselbe Lauf gerade erst als faellig behandelt hat.
 */
import { dbInternal } from "@/lib/db";

export const WEBHOOK_DELIVERY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const API_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  webhookDeliveriesDeleted: number;
  apiIdempotencyDeleted: number;
}

export async function runCleanupJob(now: Date = new Date()): Promise<CleanupResult> {
  const webhookThreshold = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS);
  const idempotencyThreshold = new Date(now.getTime() - API_IDEMPOTENCY_RETENTION_MS);

  const webhookDeliveries = await dbInternal.webhookDelivery.deleteMany({
    where: { status: { in: ["DELIVERED", "DEAD"] }, createdAt: { lt: webhookThreshold } },
  });
  const apiIdempotency = await dbInternal.apiIdempotency.deleteMany({
    where: { createdAt: { lt: idempotencyThreshold } },
  });

  return { webhookDeliveriesDeleted: webhookDeliveries.count, apiIdempotencyDeleted: apiIdempotency.count };
}
