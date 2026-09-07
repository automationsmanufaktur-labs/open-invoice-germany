import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList, parsePagination } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContactPerson } from "@/api/serializers/contact";
import { listContacts, createContact } from "@/domain/customer/contacts";
import { contactPersonInputSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createBodySchema = contactPersonInputSchema.extend({ contactId: z.string().min(1) });
const listQuerySchema = z.object({ contactId: z.string().min(1) });

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const { contactId } = listQuerySchema.parse(Object.fromEntries(searchParams));
  const { limit, offset } = parsePagination(searchParams);
  const all = await listContacts(ctx.orgId, contactId);
  const page = all.slice(offset, offset + limit);
  return apiList(page.map(serializeContactPerson), { total: all.length, limit, offset });
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const { contactId, ...rest } = createBodySchema.parse(ctx.body);
  const created = await createContact(ctx.orgId, contactId, rest);
  return apiData(serializeContactPerson(created), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/ContactPerson",
    method: "GET",
    summary: "Ansprechpartner eines Kunden auflisten",
    scope: "read",
    request: { query: listQuerySchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
  create: {
    path: "/api/v1/ContactPerson",
    method: "POST",
    summary: "Ansprechpartner anlegen",
    scope: "write",
    request: { body: createBodySchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
