import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeApiRequestLog } from "@/api/serializers/api-request-log";
import { findApiRequestLog } from "@/domain/api-log/list";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await findApiRequestLog(ctx.orgId, ctx.params.id);
  if (!row) throw new NotFoundError("Protokolleintrag nicht gefunden.");
  return apiData(serializeApiRequestLog(row));
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/ApiRequestLog/{id}",
    method: "GET",
    summary: "Anfrageprotokoll-Eintrag abrufen (inkl. Request-/Response-Body, sofern gespeichert)",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
