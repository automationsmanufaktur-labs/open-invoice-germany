/** Phase 10, Task 2 (task-2-facts.md): paginierte Listenfunktion fuer die PaymentMethod-
 *  Ressource (die bestehende `listPaymentMethods` liefert bewusst ALLE fuer UI-Dropdowns). */
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { PaymentMethod } from "@/generated/prisma/client";

export const paymentMethodListFilterSchema = z.object({
  includeInactive: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaymentMethodListFilter = z.infer<typeof paymentMethodListFilterSchema>;

export interface PaymentMethodListResult {
  rows: PaymentMethod[];
  total: number;
  limit: number;
  offset: number;
}

export async function listPaymentMethodsApi(orgId: string, rawFilter: unknown): Promise<PaymentMethodListResult> {
  const filter = paymentMethodListFilterSchema.parse(rawFilter);
  const where = { orgId, ...(filter.includeInactive ? {} : { isActive: true }) };
  const [total, rows] = await Promise.all([
    prisma.paymentMethod.count({ where }),
    prisma.paymentMethod.findMany({ where, orderBy: { sortOrder: "asc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}
