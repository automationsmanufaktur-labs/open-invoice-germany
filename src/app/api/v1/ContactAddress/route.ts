/**
 * /api/v1/ContactAddress — Kunden-Zusatzadressen (Phase 8a-Domain, task-2-facts.md
 * Registry). Nested unter einem Contact (`contactId`, Pflichtfeld): Liste erfordert
 * `contactId` als Query-Parameter, Anlegen `contactId` im Body — die zugrundeliegenden
 * Domain-Funktionen (src/domain/customer/addresses.ts) sind bereits so scoped.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList, parsePagination } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContactAddress } from "@/api/serializers/contact";
import { listAddresses, createAddress } from "@/domain/customer/addresses";
import { customerAddressInputSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createBodySchema = customerAddressInputSchema.extend({ contactId: z.string().min(1) });
const listQuerySchema = z.object({ contactId: z.string().min(1) });

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const { contactId } = listQuerySchema.parse(Object.fromEntries(searchParams));
  const { limit, offset } = parsePagination(searchParams);
  const all = await listAddresses(ctx.orgId, contactId);
  const page = all.slice(offset, offset + limit);
  return apiList(page.map(serializeContactAddress), { total: all.length, limit, offset });
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const { contactId, ...rest } = createBodySchema.parse(ctx.body);
  const created = await createAddress(ctx.orgId, contactId, rest);
  return apiData(serializeContactAddress(created), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/ContactAddress",
    method: "GET",
    summary: "Zusatzadressen eines Kunden auflisten",
    scope: "read",
    request: { query: listQuerySchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
  create: {
    path: "/api/v1/ContactAddress",
    method: "POST",
    summary: "Zusatzadresse anlegen",
    scope: "write",
    request: { body: createBodySchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
