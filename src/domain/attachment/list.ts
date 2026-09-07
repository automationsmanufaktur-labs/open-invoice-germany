/** Phase 10, Task 2 (task-2-facts.md): kleine Listenfunktion fuer die Attachment-Ressource
 *  (flach ueber alle Belegtypen einer Organisation, mit optionalem docType/docId-Filter). */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DocRefType } from "@/schemas";
import type { DocumentAttachment } from "@/generated/prisma/client";

export const attachmentListFilterSchema = z.object({
  docType: DocRefType.optional(),
  docId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AttachmentListFilter = z.infer<typeof attachmentListFilterSchema>;

export interface AttachmentListResult {
  rows: DocumentAttachment[];
  total: number;
  limit: number;
  offset: number;
}

export async function listAttachmentsApi(orgId: string, rawFilter: unknown): Promise<AttachmentListResult> {
  const filter = attachmentListFilterSchema.parse(rawFilter);
  const where = { orgId, ...(filter.docType ? { docType: filter.docType } : {}), ...(filter.docId ? { docId: filter.docId } : {}) };
  const [total, rows] = await Promise.all([
    prisma.documentAttachment.count({ where }),
    prisma.documentAttachment.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.offset, take: filter.limit }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}

export async function findAttachmentApi(orgId: string, id: string): Promise<DocumentAttachment | null> {
  return prisma.documentAttachment.findFirst({ where: { id, orgId } });
}
