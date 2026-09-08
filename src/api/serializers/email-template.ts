import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { EmailTemplate } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeEmailTemplate(t: EmailTemplate) {
  return {
    objectName: "EmailTemplate" as const,
    id: t.id,
    name: t.name,
    docType: t.docType,
    subject: t.subject,
    body: t.body,
    signature: t.signature,
    isDefault: t.isDefault,
    isSystem: t.isSystem,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeEmailTemplate abgeleitet. */
export const emailTemplateSchema = z.object({
  objectName: z.literal("EmailTemplate"),
  id: z.string(),
  name: z.string(),
  docType: z.string(),
  subject: z.string(),
  body: z.string(),
  signature: z.string().nullable(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
