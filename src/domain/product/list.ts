/** Phase 10, Task 2 (task-2-facts.md): kleine Listenfunktion fuer die Product-Ressource. */
import { z } from "zod";
import { prisma, ciContains } from "@/lib/db";
import type { Product } from "@/generated/prisma/client";

export const productListFilterSchema = z.object({
  search: z.string().max(100).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ProductListFilter = z.infer<typeof productListFilterSchema>;

export interface ProductListResult {
  rows: Product[];
  total: number;
  limit: number;
  offset: number;
}

export async function listProductsApi(orgId: string, rawFilter: unknown): Promise<ProductListResult> {
  const filter = productListFilterSchema.parse(rawFilter);
  const where = {
    orgId,
    ...(filter.includeArchived ? {} : { isArchived: false }),
    ...(filter.search ? { OR: [{ name: ciContains(filter.search) }, { articleNumber: ciContains(filter.search) }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}
