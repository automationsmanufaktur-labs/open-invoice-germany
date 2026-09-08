import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializePaymentMethod } from "@/api/serializers/payment-method";
import { listPaymentMethodsApi, paymentMethodListFilterSchema } from "@/domain/payment-method/list";
import { savePaymentMethod, PaymentMethodCodeConflictError } from "@/domain/payment-method/manage";
import { paymentMethodSchema } from "@/schemas";
import { InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listPaymentMethodsApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializePaymentMethod), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  try {
    const created = await savePaymentMethod(ctx.orgId, null, ctx.body);
    return apiData(serializePaymentMethod(created), 201);
  } catch (e) {
    if (e instanceof PaymentMethodCodeConflictError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/PaymentMethod",
    method: "GET",
    summary: "Zahlungsmethoden auflisten",
    scope: "read",
    request: { query: paymentMethodListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/PaymentMethod",
    method: "POST",
    summary: "Zahlungsmethode anlegen",
    scope: "write",
    request: { body: paymentMethodSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
