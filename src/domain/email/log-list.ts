/** Phase 10, Task 2 (task-2-facts.md): kleine Listenfunktion fuer die EmailLog-Ressource. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DocRefType } from "@/schemas";
import type { EmailLog } from "@/generated/prisma/client";

export const emailLogListFilterSchema = z.object({
  docType: DocRefType.optional(),
  docId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type EmailLogListFilter = z.infer<typeof emailLogListFilterSchema>;

export interface EmailLogListResult {
  rows: EmailLog[];
  total: number;
  limit: number;
  offset: number;
}

export async function listEmailLogsApi(orgId: string, rawFilter: unknown): Promise<EmailLogListResult> {
  const filter = emailLogListFilterSchema.parse(rawFilter);
  const where = { orgId, ...(filter.docType ? { docType: filter.docType } : {}), ...(filter.docId ? { docId: filter.docId } : {}) };
  const [total, rows] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}

export async function findEmailLogApi(orgId: string, id: string): Promise<EmailLog | null> {
  return prisma.emailLog.findFirst({ where: { id, orgId } });
}
