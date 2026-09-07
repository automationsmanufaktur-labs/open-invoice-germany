/**
 * GET one + PATCH (url/events/active/rotateSecret) fuer einen Webhook-Endpunkt (Phase 10,
 * Task 5). Kein DELETE (kein Hard-Delete im gesamten Programm — siehe endpoints.ts-
 * Kopfkommentar; Deaktivierung per PATCH {active:false}).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeWebhookEndpoint } from "@/api/serializers/webhook";
import { getWebhookEndpoint, updateWebhookEndpoint } from "@/domain/webhook/endpoints";
import { updateWebhookEndpointInputSchema } from "@/schemas/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await getWebhookEndpoint(ctx.orgId, ctx.params.id);
  return apiData(serializeWebhookEndpoint(row));
}, { scope: "admin" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const updated = await updateWebhookEndpoint(ctx.orgId, ctx.params.id, ctx.body, { actor: ctx.actor });
  return apiData({ ...serializeWebhookEndpoint(updated), ...(updated.secret ? { secret: updated.secret } : {}) });
}, { scope: "admin" });

export const spec = {
  get: {
    path: "/api/v1/Webhook/{id}",
    method: "GET",
    summary: "Webhook-Endpunkt abrufen (nie das Secret)",
    scope: "admin",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/Webhook/{id}",
    method: "PATCH",
    summary: "Webhook-Endpunkt aendern (URL/Events/aktiv/Secret-Rotation)",
    scope: "admin",
    request: { body: updateWebhookEndpointInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
