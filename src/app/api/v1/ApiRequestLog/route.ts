/**
 * /api/v1/ApiRequestLog — Anfrageprotokoll der REST-API selbst (Phase 12d, Task 5). Nur
 * GET (Deviation, wie `EmailLog`): Zeilen entstehen ausschliesslich als Nebeneffekt des
 * `withApi`-Log-Hooks (src/api/auth.ts) — es gibt keinen sinnvollen POST/PATCH-Pfad.
 * Ruling (Selbstbezug): dieser Pfad steht selbst in `UNLOGGED_PATHS`
 * (src/domain/api-log/redact.ts) — ein Abruf des Protokolls erzeugt sonst bei jedem
 * Aufruf eine neue Protokollzeile (Rekursionsschutz, siehe task-5-brief.md).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiList } from "@/api/response";
import { apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeApiRequestLog } from "@/api/serializers/api-request-log";
import { listApiRequestLogs } from "@/domain/api-log/list";
import { apiRequestLogFilterSchema } from "@/schemas/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listApiRequestLogs(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeApiRequestLog), result);
}, { scope: "read" });

export const spec = {
  list: {
    path: "/api/v1/ApiRequestLog",
    method: "GET",
    summary: "Anfrageprotokoll auflisten (Filter: apiKeyId, errorsOnly, path, from/to)",
    scope: "read",
    request: { query: apiRequestLogFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
