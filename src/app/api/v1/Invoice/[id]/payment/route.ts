/**
 * POST /api/v1/Invoice/{id}/payment — Zahlung erfassen. Task 3, task-3-facts.md: ruft
 * exakt `recordPayment` (dasselbe Zod-Schema `recordPaymentSchema` wie UI/MCP/
 * `/api/v1/Payment`). `recordPayment` prueft die Organisationszugehoerigkeit bereits
 * selbst ueber `opts.orgId` (Task-2-Fix-Runde 1, Ruling b) — kein eigener Vorab-Check
 * noetig, analog `/api/v1/Payment` (POST).
 *
 * Fix-Runde 1 (Koordinator-Befund 2): Antwort `{payment, invoice}` (statt
 * {id,status,paidAmountCents,skontoSuggestion,skontoApplied}) — die vollstaendige
 * erfasste Zahlung UND die aktualisierte Rechnung. Hinweis: `RecordPaymentResult.payment`
 * (src/domain/invoice/payment.ts) ist trotz des Feldnamens die AKTUALISIERTE RECHNUNG,
 * nicht die Zahlung selbst (bestehende, verwirrende Domain-Namensgebung, nicht Teil
 * dieses Fixes) — die echte Payment-Zeile wird weiterhin separat geladen (`created`).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeInvoice, invoiceSchema } from "@/api/serializers/invoice";
import { serializePayment, paymentSchema } from "@/api/serializers/payment";
import { recordPayment } from "@/domain/invoice/payment";
import { recordPaymentSchema } from "@/schemas";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paymentActionResponseSchema = z.object({ payment: paymentSchema, invoice: invoiceSchema });

export const POST = withApi<{ id: string }>(async (_req, ctx) => {
  const input = recordPaymentSchema.parse(ctx.body);
  const result = await recordPayment(ctx.params.id, input, { actor: ctx.actor, orgId: ctx.orgId });
  const created = await prisma.payment.findFirstOrThrow({ where: { invoiceId: ctx.params.id }, orderBy: { createdAt: "desc" } });
  return apiData(
    { payment: serializePayment(created), invoice: serializeInvoice(result.payment, new Set()) },
    201,
  );
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Invoice/{id}/payment",
    method: "POST",
    summary: "Zahlung auf eine Rechnung erfassen (liefert Zahlung + aktualisierte Rechnung)",
    scope: "write",
    request: { body: recordPaymentSchema },
    response: apiDataResponseSchema(paymentActionResponseSchema),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
