/**
 * /api/v1/Recurring — Abos / wiederkehrende Rechnungen (Fix-Runde 1, Koordinator-Ruling
 * b, Task 3, Phase 10: Basis-CRUD ergaenzt neben den bereits bestehenden Aktionen
 * `/Recurring/{id}/run` und `/Recurring/{id}/state`). `createRecurring` erwartet bereits
 * geparste Eingaben (kein eigenes Zod-Parsing, siehe src/domain/recurring/create.ts) —
 * die Route validiert deshalb selbst mit `createRecurringSchema`, exakt wie es das
 * MCP-Tool `create_recurring` bereits tut (kein Bypass, dieselbe Schema-Quelle).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeRecurring } from "@/api/serializers/recurring";
import { listRecurring, recurringListFilterSchema } from "@/domain/recurring/list";
import { createRecurring } from "@/domain/recurring/create";
import { createRecurringSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listRecurring(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeRecurring), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const input = createRecurringSchema.parse(ctx.body);
  const rec = await createRecurring(ctx.orgId, input);
  return apiData(serializeRecurring(rec), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/Recurring",
    method: "GET",
    summary: "Abos auflisten (Paginierung/Filter status,customerId,search)",
    scope: "read",
    request: { query: recurringListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/Recurring",
    method: "POST",
    summary: "Abo anlegen",
    scope: "write",
    request: { body: createRecurringSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
