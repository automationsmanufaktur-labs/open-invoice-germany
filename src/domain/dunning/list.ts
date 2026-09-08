/**
 * Phase 10, Task 2 (task-2-facts.md): kleine Listenfunktion fuer die Dunning-Ressource.
 * `Dunning` hat keine eigene `orgId`-Spalte — Mandantenschutz ueber `invoice: { orgId }`.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Dunning } from "@/generated/prisma/client";

export const dunningListFilterSchema = z.object({
  invoiceId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DunningListFilter = z.infer<typeof dunningListFilterSchema>;

export interface DunningListResult {
  rows: Dunning[];
  total: number;
  limit: number;
  offset: number;
}

export async function listDunningsApi(orgId: string, rawFilter: unknown): Promise<DunningListResult> {
  const filter = dunningListFilterSchema.parse(rawFilter);
  const where = { invoice: { orgId }, ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}) };
  const [total, rows] = await Promise.all([
    prisma.dunning.count({ where }),
    prisma.dunning.findMany({ where, orderBy: { sentAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}

export async function findDunningApi(orgId: string, id: string): Promise<Dunning | null> {
  return prisma.dunning.findFirst({ where: { id, invoice: { orgId } } });
}
