/**
 * /api/v1/Webhook — Webhook-Endpunktverwaltung ueber die API selbst (Phase 10, Task 5,
 * task-5-brief.md "/api/v1/Webhook (+ in OpenAPI)"). Nutzt dieselben Domain-Funktionen
 * wie die Session-Route `/api/webhooks` (src/domain/webhook/endpoints.ts) — kein Bypass.
 * Scope `admin` fuer ALLE Operationen (analog ApiKey/Settings, Task 1/2): ein
 * Webhook-Endpunkt kann interne Ereignisse (inkl. Rechnungsdaten) an eine beliebige
 * URL ausliefern, das ist eine sicherheitsrelevante Konfiguration, keine normale
 * Fachressource.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList, parsePagination } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeWebhookEndpoint } from "@/api/serializers/webhook";
import { listWebhookEndpoints, createWebhookEndpoint } from "@/domain/webhook/endpoints";
import { createWebhookEndpointInputSchema } from "@/schemas/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const { limit, offset } = parsePagination(searchParams);
  // Fix-Welle (Nit 14): DB-seitige Pagination (take/skip/count) statt alle Zeilen zu
  // laden und erst hier in-memory zu slicen.
  const { rows, total } = await listWebhookEndpoints(ctx.orgId, { limit, offset });
  return apiList(rows.map(serializeWebhookEndpoint), { total, limit, offset });
}, { scope: "admin" });

export const POST = withApi(async (_req, ctx) => {
  const created = await createWebhookEndpoint(ctx.orgId, ctx.body, { actor: ctx.actor });
  // Das Klartext-Secret ist NUR in dieser Antwort sichtbar (siehe endpoints.ts).
  return apiData({ ...serializeWebhookEndpoint(created), secret: created.secret }, 201);
}, { scope: "admin" });

export const spec = {
  list: {
    path: "/api/v1/Webhook",
    method: "GET",
    summary: "Webhook-Endpunkte auflisten (nie das Secret)",
    scope: "admin",
    response: apiListResponseSchema(z.unknown()),
    errors: [401, 403, 429],
  },
  create: {
    path: "/api/v1/Webhook",
    method: "POST",
    summary: "Webhook-Endpunkt anlegen (Secret nur in dieser Antwort sichtbar)",
    scope: "admin",
    request: { body: createWebhookEndpointInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
