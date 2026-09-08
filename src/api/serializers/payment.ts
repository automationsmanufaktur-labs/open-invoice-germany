import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { Payment } from "@/generated/prisma/client";
import { z } from "zod";

export function serializePayment(p: Payment) {
  return {
    objectName: "Payment" as const,
    id: p.id,
    invoiceId: p.invoiceId,
    amountCents: p.amountCents,
    paidAt: iso(p.paidAt),
    method: p.method,
    reference: p.reference,
    isSkonto: p.isSkonto,
    skontoForPaymentId: p.skontoForPaymentId,
    note: p.note,
    createdAt: iso(p.createdAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializePayment abgeleitet. */
export const paymentSchema = z.object({
  objectName: z.literal("Payment"),
  id: z.string(),
  invoiceId: z.string(),
  amountCents: z.number().int(),
  paidAt: z.string().nullable(),
  method: z.string(),
  reference: z.string().nullable(),
  isSkonto: z.boolean(),
  skontoForPaymentId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().nullable(),
});
