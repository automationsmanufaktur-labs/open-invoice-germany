import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContactPerson } from "@/api/serializers/contact";
import { updateContact } from "@/domain/customer/contacts";
import { contactPersonInputSchema } from "@/schemas";
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.contactPerson.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Ansprechpartner nicht gefunden.");
  return apiData(serializeContactPerson(row));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.contactPerson.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Ansprechpartner nicht gefunden.");
  const input = contactPersonInputSchema.parse(ctx.body);
  const updated = await updateContact(ctx.orgId, row.customerId, ctx.params.id, input);
  return apiData(serializeContactPerson(updated));
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/ContactPerson/{id}",
    method: "GET",
    summary: "Ansprechpartner abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/ContactPerson/{id}",
    method: "PATCH",
    summary: "Ansprechpartner aktualisieren",
    scope: "write",
    request: { body: contactPersonInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
