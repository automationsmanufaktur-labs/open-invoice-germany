import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeDunning } from "@/api/serializers/dunning";
import { findDunningApi } from "@/domain/dunning/list";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await findDunningApi(ctx.orgId, ctx.params.id);
  if (!row) throw new NotFoundError("Mahnung nicht gefunden.");
  return apiData(serializeDunning(row));
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/Dunning/{id}",
    method: "GET",
    summary: "Mahnung abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
