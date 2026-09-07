import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContact } from "@/api/serializers/contact";
import { customerSchema } from "@/schemas";
import { dbInternal } from "@/lib/db";
import { updateCustomer, CustomerValidationError } from "@/domain/customer/save";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.customer.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Kunde nicht gefunden.");
  return apiData(serializeContact(row));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  try {
    const updated = await updateCustomer(ctx.orgId, ctx.params.id, ctx.body);
    return apiData(serializeContact(updated));
  } catch (e) {
    if (e instanceof CustomerValidationError) throw new z.ZodError([{ code: "custom", path: ["defaultPaymentMethodId"], message: e.message }]);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/Contact/{id}",
    method: "GET",
    summary: "Kunden abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/Contact/{id}",
    method: "PATCH",
    summary: "Kunden aktualisieren (Stammdaten)",
    scope: "write",
    request: { body: customerSchema.partial() },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
