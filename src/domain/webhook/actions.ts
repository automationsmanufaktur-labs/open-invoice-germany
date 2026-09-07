/**
 * Interaktive Webhook-Aktionen (Phase 10, Task 5, task-5-brief.md "Test-Zustellung ...
 * Replay"): `sendTestDelivery` legt eine synthetische Delivery an und versucht sie
 * SOFORT (nicht ueber den Scheduler) zuzustellen — fuer unmittelbares UI-Feedback.
 * `replayWebhookDelivery` legt fuer eine bestehende (i. d. R. FAILED/DEAD) Delivery eine
 * NEUE Zeile an (nie die alte veraendern, task-5-facts.md "Replay erzeugt neue Delivery")
 * und versucht sie ebenfalls sofort — dieselbe Sofort-Zustellung wie beim Test, nur mit
 * dem echten, urspruenglichen Ereignis/Payload statt einer synthetischen Testnutzlast.
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { attemptDelivery, type AttemptResult, type FetchLike } from "./deliver";
import { getWebhookEndpointRaw } from "./endpoints";
import type { WebhookDelivery, WebhookEndpoint } from "@/generated/prisma/client";

export interface TestDeliveryOptions {
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface TestDeliveryResult {
  delivery: WebhookDelivery;
  attempt: AttemptResult;
}

/** Sendet ein synthetisches Testereignis ("webhook.test") an einen Endpunkt, unabhaengig
 *  von dessen abonnierten Events — das ist der Zweck des Tests: ist der Endpunkt
 *  ueberhaupt erreichbar/signaturfaehig, nicht "abonniert dieser Endpunkt Event X". */
export async function sendTestDelivery(orgId: string, endpointId: string, opts: TestDeliveryOptions = {}): Promise<TestDeliveryResult> {
  const now = opts.now ?? new Date();
  const endpoint: WebhookEndpoint = await getWebhookEndpointRaw(orgId, endpointId);

  const delivery = await dbInternal.webhookDelivery.create({
    data: {
      orgId,
      endpointId: endpoint.id,
      event: "webhook.test",
      objectName: "Webhook",
      objectId: endpoint.id,
      dataJson: JSON.stringify({ message: "Dies ist eine Test-Zustellung von OpenInvoice Germany." }),
      status: "PENDING",
      nextAttemptAt: now,
    },
  });

  const fetchImpl = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  const attempt = await attemptDelivery({ ...delivery, endpoint }, fetchImpl, now);
  const updated = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  return { delivery: updated, attempt };
}

export interface ReplayOptions {
  fetchImpl?: FetchLike;
  now?: Date;
}

/** Legt fuer `deliveryId` eine NEUE Delivery-Zeile mit demselben Ereignis/Payload an
 *  (`replayOfId` verweist auf das Original) und versucht sie sofort zuzustellen. */
export async function replayWebhookDelivery(orgId: string, deliveryId: string, opts: ReplayOptions = {}): Promise<TestDeliveryResult> {
  const now = opts.now ?? new Date();
  const original = await dbInternal.webhookDelivery.findFirst({ where: { id: deliveryId, orgId } });
  if (!original) throw new NotFoundError(`Zustellung ${deliveryId} nicht gefunden.`);

  const endpoint = await getWebhookEndpointRaw(orgId, original.endpointId);

  const replay = await dbInternal.webhookDelivery.create({
    data: {
      orgId,
      endpointId: original.endpointId,
      event: original.event,
      objectName: original.objectName,
      objectId: original.objectId,
      dataJson: original.dataJson,
      status: "PENDING",
      nextAttemptAt: now,
      replayOfId: original.id,
    },
  });

  const fetchImpl = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  const attempt = await attemptDelivery({ ...replay, endpoint }, fetchImpl, now);
  const updated = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: replay.id } });
  return { delivery: updated, attempt };
}

export interface ListDeliveriesFilter {
  status?: "PENDING" | "DELIVERED" | "FAILED" | "DEAD";
  limit?: number;
  offset?: number;
}

/** Zustellprotokoll eines Endpunkts (task-5-brief.md UI "Zustellprotokoll mit
 *  Status/Antwortcode/Versuchen"). Org-gescoped ueber den Endpunkt selbst. */
export async function listWebhookDeliveries(orgId: string, endpointId: string, filter: ListDeliveriesFilter = {}) {
  await getWebhookEndpointRaw(orgId, endpointId); // wirft NotFoundError bei fremder/unbekannter ID
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const where = { orgId, endpointId, ...(filter.status ? { status: filter.status } : {}) };
  const [rows, total] = await Promise.all([
    dbInternal.webhookDelivery.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    dbInternal.webhookDelivery.count({ where }),
  ]);
  return { rows, total, limit, offset };
}
