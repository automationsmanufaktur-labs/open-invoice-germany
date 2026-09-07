/**
 * /api/v1/Quote — Angebote (Quote-Modell mit kind=ANGEBOT, task-2-facts.md Registry:
 * Quote/OrderConfirmation teilen sich dieselbe Prisma-Tabelle, unterschieden per `kind`
 * — siehe /api/v1/OrderConfirmation fuer kind=AUFTRAGSBESTAETIGUNG). `kind` wird server-
 * seitig erzwungen, ein vom Client mitgeschickter Wert wird ignoriert/ueberschrieben.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeQuote } from "@/api/serializers/document";
import { parseEmbed } from "@/api/serializers/common";
import { listQuotes, quoteListFilterSchema } from "@/domain/document/list";
import { createBusinessDocument } from "@/domain/document/create";
import { createDocumentSchema } from "@/schemas";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const embed = parseEmbed(searchParams);
  const raw = { ...Object.fromEntries(searchParams), kind: "ANGEBOT" };
  const result = await listQuotes(ctx.orgId, raw);
  if (!embed.has("lines") && !embed.has("customer")) {
    return apiList(
      result.rows.map((r) => serializeQuote({ ...r } as never, "Quote", embed)),
      result,
    );
  }
  const ids = result.rows.map((r) => r.id);
  const full = await prisma.quote.findMany({
    where: { id: { in: ids } },
    include: { lines: embed.has("lines"), customer: embed.has("customer") },
  });
  const byId = new Map(full.map((q) => [q.id, q]));
  return apiList(
    result.rows.map((r) => serializeQuote(byId.get(r.id) as never, "Quote", embed)),
    result,
  );
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const input = createDocumentSchema.parse({ ...(ctx.body as object), kind: "ANGEBOT" });
  const doc = await createBusinessDocument(ctx.orgId, input, { actor: ctx.actor });
  const full = await prisma.quote.findUniqueOrThrow({ where: { id: doc.id } });
  return apiData(serializeQuote(full, "Quote", new Set()), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/Quote",
    method: "GET",
    summary: "Angebote auflisten (Paginierung/Filter/embed=customer,lines)",
    scope: "read",
    request: { query: quoteListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/Quote",
    method: "POST",
    summary: "Angebot anlegen (Entwurf)",
    scope: "write",
    request: { body: createDocumentSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
