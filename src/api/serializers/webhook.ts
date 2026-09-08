import "../openapi-zod-init"; // Fix-Runde 1 (Task 4): MUSS vor jedem z.object()-Aufruf hier stehen
import { z } from "zod";
import { iso } from "./common";

export interface SerializableWebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Serialisiert einen Webhook-Endpunkt (Phase 10, Task 5). Nimmt bewusst die bereits
 *  entzuckerte `WebhookEndpointView` (src/domain/webhook/endpoints.ts) entgegen, NICHT
 *  die rohe Prisma-Zeile — die View traegt `events` bereits als Array und NIE
 *  `secretEnc`; das Klartext-Secret existiert ausschliesslich in der Antwort von
 *  createWebhookEndpoint/updateWebhookEndpoint({rotateSecret:true}). */
export function serializeWebhookEndpoint(row: SerializableWebhookEndpoint) {
  return {
    objectName: "Webhook" as const,
    id: row.id,
    url: row.url,
    events: row.events,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** OpenAPI-Response-Schema (Phase 10, Task 4/5) — aus serializeWebhookEndpoint abgeleitet. */
export const webhookSchema = z.object({
  objectName: z.literal("Webhook"),
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
