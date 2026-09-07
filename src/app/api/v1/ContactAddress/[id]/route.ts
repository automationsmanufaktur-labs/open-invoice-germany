import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContactAddress } from "@/api/serializers/contact";
import { updateAddress } from "@/domain/customer/addresses";
import { customerAddressInputSchema } from "@/schemas";
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.customerAddress.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Adresse nicht gefunden.");
  return apiData(serializeContactAddress(row));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.customerAddress.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Adresse nicht gefunden.");
  const input = customerAddressInputSchema.parse(ctx.body);
  const updated = await updateAddress(ctx.orgId, row.customerId, ctx.params.id, input);
  return apiData(serializeContactAddress(updated));
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/ContactAddress/{id}",
    method: "GET",
    summary: "Zusatzadresse abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/ContactAddress/{id}",
    method: "PATCH",
    summary: "Zusatzadresse aktualisieren",
    scope: "write",
    request: { body: customerAddressInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
