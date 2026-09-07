/** Phase 10, Task 2 (task-2-facts.md): paginierte Listenfunktion fuer die EmailTemplate-Ressource. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DocType } from "@/schemas";
import type { EmailTemplate } from "@/generated/prisma/client";

export const emailTemplateListFilterSchema = z.object({
  docType: DocType.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type EmailTemplateListFilter = z.infer<typeof emailTemplateListFilterSchema>;

export interface EmailTemplateListResult {
  rows: EmailTemplate[];
  total: number;
  limit: number;
  offset: number;
}

export async function listEmailTemplatesApi(orgId: string, rawFilter: unknown): Promise<EmailTemplateListResult> {
  const filter = emailTemplateListFilterSchema.parse(rawFilter);
  const where = { orgId, ...(filter.docType ? { docType: filter.docType } : {}) };
  const [total, rows] = await Promise.all([
    prisma.emailTemplate.count({ where }),
    prisma.emailTemplate.findMany({ where, orderBy: { name: "asc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}
