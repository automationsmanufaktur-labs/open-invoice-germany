import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { EmailLog } from "@/generated/prisma/client";
import { z } from "zod";

function parseJsonArray(json: string): unknown[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function serializeEmailLog(l: EmailLog) {
  return {
    objectName: "EmailLog" as const,
    id: l.id,
    docType: l.docType,
    docId: l.docId,
    templateId: l.templateId,
    to: parseJsonArray(l.toJson),
    cc: parseJsonArray(l.ccJson),
    bcc: parseJsonArray(l.bccJson),
    fromEmail: l.fromEmail,
    replyTo: l.replyTo,
    subject: l.subject,
    // bodySnapshot ist der volle E-Mail-Text (kein internes Notizfeld) — bewusst enthalten.
    body: l.bodySnapshot,
    attachments: parseJsonArray(l.attachmentsJson),
    status: l.status,
    providerId: l.providerId,
    error: l.error,
    warnings: parseJsonArray(l.warningsJson),
    resendOfId: l.resendOfId,
    sentByUserId: l.sentByUserId,
    sentAt: iso(l.sentAt),
    createdAt: iso(l.createdAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeEmailLog abgeleitet. */
export const emailLogSchema = z.object({
  objectName: z.literal("EmailLog"),
  id: z.string(),
  docType: z.string(),
  docId: z.string(),
  templateId: z.string().nullable(),
  to: z.array(z.unknown()),
  cc: z.array(z.unknown()),
  bcc: z.array(z.unknown()),
  fromEmail: z.string(),
  replyTo: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  attachments: z.array(z.unknown()),
  status: z.string(),
  providerId: z.string().nullable(),
  error: z.string().nullable(),
  warnings: z.array(z.unknown()),
  resendOfId: z.string().nullable(),
  sentByUserId: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});
