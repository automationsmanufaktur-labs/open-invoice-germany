import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeQuote } from "@/api/serializers/document";
import { parseEmbed } from "@/api/serializers/common";
import { updateDraftDocument } from "@/domain/document/update";
import { updateDocumentSchema } from "@/schemas";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const embed = parseEmbed(searchParams);
  const row = await prisma.quote.findFirst({
    where: { id: ctx.params.id, orgId: ctx.orgId, kind: "ANGEBOT" },
    include: { lines: embed.has("lines"), customer: embed.has("customer") },
  });
  if (!row) throw new NotFoundError("Angebot nicht gefunden.");
  return apiData(serializeQuote(row, "Quote", embed));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await prisma.quote.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId, kind: "ANGEBOT" }, select: { id: true } });
  if (!existing) throw new NotFoundError("Angebot nicht gefunden.");
  const input = updateDocumentSchema.parse(ctx.body);
  await updateDraftDocument(ctx.orgId, ctx.params.id, input, ctx.actor);
  const full = await prisma.quote.findUniqueOrThrow({ where: { id: ctx.params.id } });
  return apiData(serializeQuote(full, "Quote", new Set()));
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/Quote/{id}",
    method: "GET",
    summary: "Angebot abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/Quote/{id}",
    method: "PATCH",
    summary: "Angebot aktualisieren (nur Entwurf)",
    scope: "write",
    request: { body: updateDocumentSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
