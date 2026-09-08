import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { DocumentAttachment } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeAttachment(a: DocumentAttachment) {
  return {
    objectName: "Attachment" as const,
    id: a.id,
    docType: a.docType,
    docId: a.docId,
    filename: a.filename,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    uploadedBy: a.uploadedBy,
    createdAt: iso(a.createdAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeAttachment abgeleitet. */
export const attachmentSchema = z.object({
  objectName: z.literal("Attachment"),
  id: z.string(),
  docType: z.string(),
  docId: z.string(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  uploadedBy: z.string(),
  createdAt: z.string().nullable(),
});
