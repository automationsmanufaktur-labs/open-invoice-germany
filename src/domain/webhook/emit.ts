/**
 * Outbox-Schreiber fuer Webhook-Ereignisse (Phase 10, Task 5, task-5-facts.md): legt fuer
 * JEDEN aktiven Endpunkt der Organisation, der `type` abonniert hat, eine
 * `WebhookDelivery`-Zeile (status PENDING) an — MUSS mit dem `tx`-Parameter des
 * Aufrufers laufen (derselbe Transaktion-Client wie `appendChangeLog`), niemals mit
 * `dbInternal` direkt. Die eigentliche Zustellung passiert ausschliesslich spaeter, im
 * Scheduler-Job "webhooks" (src/domain/webhook/deliver.ts) — `emitEvent` selbst macht
 * keinen Netzwerkzugriff und kann daher innerhalb einer DB-Transaktion laufen.
 *
 * `data` ist bereits der fertige Serializer-Schnappschuss (Task 2, z. B.
 * `serializeInvoice(invoice, new Set())`) OHNE `internalNotes` — `emitEvent` selbst
 * filtert nichts mehr, die Aufrufer uebergeben ausschliesslich Serializer-Ausgaben.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { WebhookEvent } from "@/schemas/webhook";

export interface EmitEventInput {
  orgId: string;
  type: WebhookEvent;
  objectName: string;
  objectId: string;
  /** Serializer-Ausgabe (Task 2) — niemals ein rohes Prisma-Model, niemals internalNotes. */
  data: unknown;
  now?: Date;
}

export async function emitEvent(tx: Prisma.TransactionClient, input: EmitEventInput): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { orgId: input.orgId, active: true },
    select: { id: true, eventsJson: true },
  });
  if (endpoints.length === 0) return;

  const now = input.now ?? new Date();
  const dataJson = JSON.stringify(input.data);

  for (const ep of endpoints) {
    let events: string[];
    try {
      events = JSON.parse(ep.eventsJson) as string[];
    } catch {
      continue; // defensiv — sollte durch createWebhookEndpoint/updateWebhookEndpoint nie vorkommen
    }
    if (!events.includes(input.type)) continue;

    await tx.webhookDelivery.create({
      data: {
        orgId: input.orgId,
        endpointId: ep.id,
        event: input.type,
        objectName: input.objectName,
        objectId: input.objectId,
        dataJson,
        status: "PENDING",
        nextAttemptAt: now,
      },
    });
  }
}
