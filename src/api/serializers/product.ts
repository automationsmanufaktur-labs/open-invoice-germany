import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { Product } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeProduct(p: Product) {
  return {
    objectName: "Product" as const,
    id: p.id,
    name: p.name,
    description: p.description,
    articleNumber: p.articleNumber,
    unit: p.unit,
    netPriceCents: p.netPriceCents,
    taxRate: p.taxRate,
    taxCategory: p.taxCategory,
    differential: p.differential,
    isArchived: p.isArchived,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeProduct abgeleitet. */
export const productSchema = z.object({
  objectName: z.literal("Product"),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  articleNumber: z.string().nullable(),
  unit: z.string(),
  netPriceCents: z.number().int(),
  taxRate: z.number().int(),
  taxCategory: z.string(),
  differential: z.boolean(),
  isArchived: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
