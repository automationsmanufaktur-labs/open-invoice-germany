import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeEmailLog } from "@/api/serializers/email-log";
import { findEmailLogApi } from "@/domain/email/log-list";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await findEmailLogApi(ctx.orgId, ctx.params.id);
  if (!row) throw new NotFoundError("Protokolleintrag nicht gefunden.");
  return apiData(serializeEmailLog(row));
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/EmailLog/{id}",
    method: "GET",
    summary: "Versandprotokoll-Eintrag abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
