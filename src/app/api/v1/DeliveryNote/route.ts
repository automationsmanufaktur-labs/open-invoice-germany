import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeDeliveryNote } from "@/api/serializers/delivery-note";
import { parseEmbed } from "@/api/serializers/common";
import { listDeliveryNotes, deliveryNoteListFilterSchema } from "@/domain/document/list";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { createDeliveryNoteSchema } from "@/schemas";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const embed = parseEmbed(searchParams);
  const result = await listDeliveryNotes(ctx.orgId, Object.fromEntries(searchParams));
  if (!embed.has("lines") && !embed.has("customer")) {
    return apiList(
      result.rows.map((r) => serializeDeliveryNote({ ...r } as never, embed)),
      result,
    );
  }
  const ids = result.rows.map((r) => r.id);
  const full = await prisma.deliveryNote.findMany({
    where: { id: { in: ids } },
    include: { lines: embed.has("lines"), customer: embed.has("customer") },
  });
  const byId = new Map(full.map((d) => [d.id, d]));
  return apiList(
    result.rows.map((r) => serializeDeliveryNote(byId.get(r.id) as never, embed)),
    result,
  );
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const input = createDeliveryNoteSchema.parse(ctx.body);
  const note = await createDeliveryNote(ctx.orgId, input, { actor: ctx.actor });
  const full = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: note.id } });
  return apiData(serializeDeliveryNote(full, new Set()), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/DeliveryNote",
    method: "GET",
    summary: "Lieferscheine auflisten (Paginierung/Filter/embed=customer,lines)",
    scope: "read",
    request: { query: deliveryNoteListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/DeliveryNote",
    method: "POST",
    summary: "Lieferschein anlegen (Entwurf)",
    scope: "write",
    request: { body: createDeliveryNoteSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
