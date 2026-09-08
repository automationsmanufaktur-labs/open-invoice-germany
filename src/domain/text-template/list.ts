/** Phase 10, Task 2 (task-2-facts.md): paginierte Listenfunktion fuer die TextTemplate-Ressource. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DocType, TextTemplatePosition } from "@/schemas";
import type { TextTemplate } from "@/generated/prisma/client";

export const textTemplateListFilterSchema = z.object({
  docType: DocType.optional(),
  position: TextTemplatePosition.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TextTemplateListFilter = z.infer<typeof textTemplateListFilterSchema>;

export interface TextTemplateListResult {
  rows: TextTemplate[];
  total: number;
  limit: number;
  offset: number;
}

export async function listTextTemplatesApi(orgId: string, rawFilter: unknown): Promise<TextTemplateListResult> {
  const filter = textTemplateListFilterSchema.parse(rawFilter);
  const where = { orgId, ...(filter.docType ? { docType: filter.docType } : {}), ...(filter.position ? { position: filter.position } : {}) };
  const [total, rows] = await Promise.all([
    prisma.textTemplate.count({ where }),
    prisma.textTemplate.findMany({ where, orderBy: { name: "asc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}
