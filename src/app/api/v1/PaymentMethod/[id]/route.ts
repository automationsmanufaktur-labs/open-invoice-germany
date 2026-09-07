import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializePaymentMethod } from "@/api/serializers/payment-method";
import { savePaymentMethod, PaymentMethodNotFoundError, SystemPaymentMethodProtectedError, PaymentMethodCodeConflictError } from "@/domain/payment-method/manage";
import { paymentMethodSchema } from "@/schemas";
import { dbInternal } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.paymentMethod.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Zahlungsmethode nicht gefunden.");
  return apiData(serializePaymentMethod(row));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  try {
    const updated = await savePaymentMethod(ctx.orgId, ctx.params.id, ctx.body);
    return apiData(serializePaymentMethod(updated));
  } catch (e) {
    if (e instanceof PaymentMethodNotFoundError) throw new NotFoundError(e.message || "Zahlungsmethode nicht gefunden.");
    if (e instanceof SystemPaymentMethodProtectedError || e instanceof PaymentMethodCodeConflictError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/PaymentMethod/{id}",
    method: "GET",
    summary: "Zahlungsmethode abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/PaymentMethod/{id}",
    method: "PATCH",
    summary: "Zahlungsmethode aktualisieren",
    scope: "write",
    request: { body: paymentMethodSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
