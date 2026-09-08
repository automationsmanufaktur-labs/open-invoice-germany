/**
 * /api/v1/EmailLog — Versandprotokoll. Nur GET (Deviation, siehe task-2-report.md):
 * EmailLog-Zeilen entstehen ausschliesslich als Nebeneffekt von `sendDocumentEmail`
 * (Task 3, Aktions-Endpunkt `/send`) — es gibt keinen sinnvollen eigenstaendigen
 * POST/PATCH-Pfad, der nicht mit `/send` kollidieren wuerde.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiList } from "@/api/response";
import { apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeEmailLog } from "@/api/serializers/email-log";
import { listEmailLogsApi, emailLogListFilterSchema } from "@/domain/email/log-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listEmailLogsApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeEmailLog), result);
}, { scope: "read" });

export const spec = {
  list: {
    path: "/api/v1/EmailLog",
    method: "GET",
    summary: "Versandprotokoll auflisten (optional nach docType/docId)",
    scope: "read",
    request: { query: emailLogListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
