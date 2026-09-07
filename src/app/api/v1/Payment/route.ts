/**
 * /api/v1/Payment — Zahlungen (task-2-facts.md Registry). Kein PATCH (Zahlungen sind
 * append-only, es gibt keine Domain-Funktion zum Aendern einer erfassten Zahlung).
 * Fix-Runde 1 (Koordinator-Ruling b, 2026-09-04): `recordPayment` prueft jetzt selbst
 * (per optionalem `opts.orgId`) die Organisationszugehoerigkeit der invoiceId — der
 * fruehere Vorab-Check per eigenem `prisma.invoice.findFirst` in dieser Route entfaellt.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializePayment } from "@/api/serializers/payment";
import { listPaymentsApi, paymentListFilterSchema } from "@/domain/invoice/payment-list";
import { recordPayment } from "@/domain/invoice/payment";
import { recordPaymentSchema } from "@/schemas";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createBodySchema = recordPaymentSchema.extend({ invoiceId: z.string().min(1) });

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listPaymentsApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializePayment), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const { invoiceId, ...rest } = createBodySchema.parse(ctx.body);
  await recordPayment(invoiceId, rest, { actor: ctx.actor, orgId: ctx.orgId });
  const created = await prisma.payment.findFirstOrThrow({ where: { invoiceId }, orderBy: { createdAt: "desc" } });
  return apiData(serializePayment(created), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/Payment",
    method: "GET",
    summary: "Zahlungen auflisten (optional nach invoiceId)",
    scope: "read",
    request: { query: paymentListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/Payment",
    method: "POST",
    summary: "Zahlung erfassen",
    scope: "write",
    request: { body: createBodySchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
