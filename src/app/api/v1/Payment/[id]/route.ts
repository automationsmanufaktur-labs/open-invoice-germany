import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializePayment } from "@/api/serializers/payment";
import { findPaymentApi } from "@/domain/invoice/payment-list";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await findPaymentApi(ctx.orgId, ctx.params.id);
  if (!row) throw new NotFoundError("Zahlung nicht gefunden.");
  return apiData(serializePayment(row));
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/Payment/{id}",
    method: "GET",
    summary: "Zahlung abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
