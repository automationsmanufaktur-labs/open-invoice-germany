/**
 * Zod-Schemas fuer Webhooks (Phase 10, Task 5, task-5-facts.md). Einzige Quelle fuer die
 * unterstuetzten Ereignisnamen (WEBHOOK_EVENTS) — Domain (emit-Aufrufe), Routen, MCP-Tools
 * und OpenAPI-Registry importieren ausschliesslich von hier (§50: Zod an jeder Boundary).
 */
import { z } from "zod";

export const WEBHOOK_EVENTS = [
  "invoice.finalized",
  "invoice.cancelled",
  "invoice.paid",
  "payment.recorded",
  "quote.sent",
  "quote.accepted",
  "quote.rejected",
  "delivery_note.created",
  "email.sent",
  "email.failed",
  "dunning.created",
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const createWebhookEndpointInputSchema = z.object({
  url: z.string().url("Ungueltige URL."),
  events: z.array(webhookEventSchema).min(1, "Mindestens ein Ereignis erforderlich."),
  active: z.boolean().optional(),
});
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointInputSchema>;

export const updateWebhookEndpointInputSchema = z.object({
  url: z.string().url("Ungueltige URL.").optional(),
  events: z.array(webhookEventSchema).min(1, "Mindestens ein Ereignis erforderlich.").optional(),
  active: z.boolean().optional(),
  /** Erzeugt ein neues Secret; das alte wird ungueltig. Klartext nur in der Antwort dieses Aufrufs. */
  rotateSecret: z.boolean().optional(),
});
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointInputSchema>;

/** Paginierungs-/Filterparameter fuer die Zustellprotokoll-Liste eines Endpunkts. */
export const webhookDeliveryListFilterSchema = z.object({
  status: z.enum(["PENDING", "DELIVERED", "FAILED", "DEAD"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
