/**
 * Phase 10, Task 2 (task-2-facts.md): kleine Listenfunktion fuer die Payment-Ressource.
 * `Payment` hat keine eigene `orgId`-Spalte — Mandantenschutz laeuft ueber die Relation
 * zur Invoice (`invoice: { orgId }`).
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Payment } from "@/generated/prisma/client";

export const paymentListFilterSchema = z.object({
  invoiceId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaymentListFilter = z.infer<typeof paymentListFilterSchema>;

export interface PaymentListResult {
  rows: Payment[];
  total: number;
  limit: number;
  offset: number;
}

export async function listPaymentsApi(orgId: string, rawFilter: unknown): Promise<PaymentListResult> {
  const filter = paymentListFilterSchema.parse(rawFilter);
  const where = { invoice: { orgId }, ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}) };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: { paidAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}

/** Org-gescopte Einzelabfrage (fuer GET /api/v1/Payment/[id] und den Vorab-Check in
 *  POST-Routen, die auf eine fremde invoiceId 404 statt den ungeprueften recordPayment-
 *  Pfad liefern sollen — siehe task-2-report.md "Payment/Dunning ohne orgId-Spalte"). */
export async function findPaymentApi(orgId: string, id: string): Promise<Payment | null> {
  return prisma.payment.findFirst({ where: { id, invoice: { orgId } } });
}
