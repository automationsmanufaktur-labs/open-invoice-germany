/**
 * POST /api/v1/Invoice/{id}/send — Rechnung/Gutschrift per E-Mail versenden. Task 3,
 * task-3-facts.md: ruft exakt `sendDocumentEmail` (dieselbe Domain-Funktion wie die
 * Session-Route `/api/emails/send` und das MCP-Tool `send_email`), dieselbe Validierung
 * (`sendEmailInputSchema`, wird INNERHALB von `sendDocumentEmail` erneut geparst — kein
 * Bypass, Lastenheft §55). docType/docId kommen aus der URL bzw. dem Rechnungstyp (nicht
 * vom Aufrufer waehlbar) — `to`/`cc`/`bcc` werden hier als Array entgegengenommen (wie
 * beim MCP-Tool) und zu kommagetrennten Strings zusammengefuehrt, da `sendEmailInputSchema`
 * intern kommagetrennte Strings erwartet. Ad-hoc-Dateianhaenge (spontane Uploads wie in
 * der HTTP-Session-Route) sind bewusst NICHT Teil dieser Aktion — Aufrufer nutzen
 * bestehende Beleganhaenge (`attachmentIds`) oder Standardanhaenge (`standardAttachments`).
 *
 * Fix-Runde 1 (Koordinator-Befund 2): Antwortfeld `logId` in `emailLogId` umbenannt,
 * `spec.response` nutzt jetzt ein explizites `{emailLogId,status}`-Schema statt `z.unknown()`.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { sendDocumentEmail, EmailAttachmentsTooLargeError } from "@/domain/email/send";
import { DocumentNotFoundError } from "@/domain/email/context";
import type { SendEmailRawInput } from "@/schemas/email";
import { prisma } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sendActionResponseSchema = z.object({ emailLogId: z.string(), status: z.string() });

const sendActionBodySchema = z.object({
  to: z.array(z.string()).min(1),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50000),
  signature: z.string().max(5000).optional(),
  copyToSelf: z.boolean().default(false),
  standardAttachments: z.array(z.string()).optional(),
  attachmentIds: z.array(z.string()).optional(),
  templateId: z.string().optional(),
});

export const POST = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await prisma.invoice.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId }, select: { id: true, type: true } });
  if (!existing) throw new NotFoundError("Rechnung nicht gefunden.");
  const body = sendActionBodySchema.parse(ctx.body);

  const rawInput: SendEmailRawInput = {
    docType: existing.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
    docId: existing.id,
    to: body.to.join(","),
    cc: (body.cc ?? []).join(","),
    bcc: (body.bcc ?? []).join(","),
    subject: body.subject,
    body: body.body,
    signature: body.signature ?? "",
    copyToSelf: body.copyToSelf,
    standardAttachments: body.standardAttachments ?? [],
    templateId: body.templateId,
    attachmentIds: body.attachmentIds ?? [],
    warnings: [],
  };

  try {
    const result = await sendDocumentEmail(ctx.orgId, ctx.actor, rawInput, []);
    if (result.status === "FAILED") throw new InvalidOperationError(result.error ?? "Versand fehlgeschlagen.");
    return apiData({ emailLogId: result.logId, status: result.status });
  } catch (e) {
    if (e instanceof DocumentNotFoundError) throw new NotFoundError(e.message);
    if (e instanceof EmailAttachmentsTooLargeError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "send" });

export const spec = {
  create: {
    path: "/api/v1/Invoice/{id}/send",
    method: "POST",
    summary: "Rechnung/Gutschrift per E-Mail versenden",
    scope: "send",
    request: { body: sendActionBodySchema },
    response: apiDataResponseSchema(sendActionResponseSchema),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
