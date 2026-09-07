/**
 * GET one + PATCH { revoked: true } (Widerruf — Stammdaten-Aenderung im Sinne der
 * task-2-facts.md-Regel "PATCH nur DRAFT (Belege) bzw. Stammdaten"; ApiKey hat sonst
 * keine aenderbaren Felder). Nutzt `revokeApiKey` (Task 1) — kein Bypass.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeApiKey } from "@/api/serializers/api-key";
import { revokeApiKey } from "@/domain/api-key/revoke";
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import type { ApiKeyScope } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toSummary(row: { id: string; name: string; prefix: string; scopesJson: string; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
  return { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopesJson.split(",").filter(Boolean) as ApiKeyScope[], lastUsedAt: row.lastUsedAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt, createdAt: row.createdAt };
}

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.apiKey.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("API-Schluessel nicht gefunden.");
  return apiData(serializeApiKey(toSummary(row)));
}, { scope: "admin" });

const patchBodySchema = z.object({ revoked: z.literal(true) });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  patchBodySchema.parse(ctx.body);
  await revokeApiKey(ctx.orgId, ctx.params.id, ctx.actor);
  const row = await dbInternal.apiKey.findFirstOrThrow({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  return apiData(serializeApiKey(toSummary(row)));
}, { scope: "admin" });

export const spec = {
  get: {
    path: "/api/v1/ApiKey/{id}",
    method: "GET",
    summary: "API-Schluessel abrufen (nie Token/Hash)",
    scope: "admin",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/ApiKey/{id}",
    method: "PATCH",
    summary: "API-Schluessel widerrufen ({revoked:true})",
    scope: "admin",
    request: { body: patchBodySchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
