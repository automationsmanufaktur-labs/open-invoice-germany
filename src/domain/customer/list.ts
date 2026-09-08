/**
 * Phase 10, Task 2 (task-2-facts.md): kleine Listenfunktion fuer die Contact-Ressource
 * (=Customer) — org-gescoped, Paginierung/Filter fuer die API (`GET /api/v1/Contact`).
 * `search` sucht ueber Name/Kundennummer/E-Mail (analog dem bisherigen Kundenlisten-UI).
 */
import { z } from "zod";
import { prisma, ciContains } from "@/lib/db";
import type { Customer } from "@/generated/prisma/client";

export const contactListFilterSchema = z.object({
  search: z.string().max(100).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ContactListFilter = z.infer<typeof contactListFilterSchema>;

export interface ContactListResult {
  rows: Customer[];
  total: number;
  limit: number;
  offset: number;
}

export async function listContactsApi(orgId: string, rawFilter: unknown): Promise<ContactListResult> {
  const filter = contactListFilterSchema.parse(rawFilter);
  const where = {
    orgId,
    ...(filter.includeArchived ? {} : { isArchived: false }),
    ...(filter.search
      ? {
          OR: [{ name: ciContains(filter.search) }, { customerNumber: ciContains(filter.search) }, { email: ciContains(filter.search) }],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}
