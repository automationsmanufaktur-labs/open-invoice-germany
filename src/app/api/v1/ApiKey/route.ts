/**
 * /api/v1/ApiKey — API-Schluesselverwaltung ueber die API selbst (task-2-facts.md
 * Registry). Nutzt dieselben Domain-Funktionen wie die Session-Route `/api/api-keys`
 * (src/domain/api-key/*, Task 1) — kein Bypass. Scope `admin` fuer GET UND POST.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList, parsePagination } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeApiKey } from "@/api/serializers/api-key";
import { listApiKeys } from "@/domain/api-key/list";
import { createApiKey } from "@/domain/api-key/create";
import { createApiKeyInputSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const { limit, offset } = parsePagination(searchParams);
  // Fix-Welle (Nit 14): DB-seitige Pagination (take/skip/count) statt alle Zeilen zu
  // laden und erst hier in-memory zu slicen.
  const { rows, total } = await listApiKeys(ctx.orgId, { limit, offset });
  return apiList(rows.map(serializeApiKey), { total, limit, offset });
}, { scope: "admin" });

export const POST = withApi(async (_req, ctx) => {
  const input = createApiKeyInputSchema.parse(ctx.body);
  const created = await createApiKey(ctx.orgId, input, ctx.actor);
  // Das Klartext-Token ist NUR in dieser Antwort sichtbar (siehe create.ts) — der
  // Serialisierer selbst kennt kein Token (ApiKeySummary), daher hier explizit angehaengt.
  // lastUsedAt/revokedAt existieren bei einem frisch erzeugten Schluessel noch nicht.
  return apiData(
    { ...serializeApiKey({ ...created, lastUsedAt: null, revokedAt: null }), token: created.token },
    201,
  );
}, { scope: "admin" });

export const spec = {
  list: {
    path: "/api/v1/ApiKey",
    method: "GET",
    summary: "API-Schluessel auflisten (nie Token/Hash)",
    scope: "admin",
    response: apiListResponseSchema(z.unknown()),
    errors: [401, 403, 429],
  },
  create: {
    path: "/api/v1/ApiKey",
    method: "POST",
    summary: "API-Schluessel erzeugen (Token nur in dieser Antwort sichtbar)",
    scope: "admin",
    request: { body: createApiKeyInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
