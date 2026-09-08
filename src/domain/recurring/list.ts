/**
 * Fix-Runde 1 (Koordinator-Ruling b, Task 3, Phase 10): paginierte Listenfunktion fuer
 * die Recurring-Ressource (`GET /api/v1/Recurring`) — org-gescoped, Filter nach Status/
 * Kunde/Suche (Titel), analog den uebrigen `list*Api`-Funktionen aus Task 2
 * (src/domain/customer/list.ts u. a.).
 */
import { z } from "zod";
import { prisma, ciContains } from "@/lib/db";
import type { RecurringInvoice } from "@/generated/prisma/client";

export const recurringListFilterSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).optional(),
  customerId: z.string().optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RecurringListFilter = z.infer<typeof recurringListFilterSchema>;

export interface RecurringListResult {
  rows: RecurringInvoice[];
  total: number;
  limit: number;
  offset: number;
}

export async function listRecurring(orgId: string, rawFilter: unknown): Promise<RecurringListResult> {
  const filter = recurringListFilterSchema.parse(rawFilter);
  const where = {
    orgId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.search ? { title: ciContains(filter.search) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.recurringInvoice.count({ where }),
    prisma.recurringInvoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}
