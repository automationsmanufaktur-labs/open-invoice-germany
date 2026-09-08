import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { TextTemplate } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeTextTemplate(t: TextTemplate) {
  return {
    objectName: "TextTemplate" as const,
    id: t.id,
    name: t.name,
    docType: t.docType,
    position: t.position,
    body: t.body,
    isDefault: t.isDefault,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeTextTemplate abgeleitet. */
export const textTemplateSchema = z.object({
  objectName: z.literal("TextTemplate"),
  id: z.string(),
  name: z.string(),
  docType: z.string(),
  position: z.string(),
  body: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
