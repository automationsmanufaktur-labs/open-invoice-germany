// ── E-Mail-Versand (neu, Task 1) ───────────────────────────────────────────────
// Facts Task 1: send_email ruft sendDocumentEmail(orgId, actor "mcp", input, extra,
// provider?) — dieselbe Domain-Funktion wie /api/emails/send, dieselbe Zod
// (sendEmailInputSchema, wird INNERHALB von sendDocumentEmail geparst — kein Bypass,
// Lastenheft §55). provider ist ueber ctx.mailProvider injizierbar (Tests, kein echtes
// SMTP/Mailcow noetig). Ad-hoc-Dateianhaenge (spontane Uploads wie in der HTTP-Route)
// sind bewusst NICHT Teil dieses Tools — MCP-Aufrufer nutzen bestehende Beleganhaenge
// (attachmentIds) oder Standardanhaenge (standardAttachments); "extra" bleibt leer.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { sendDocumentEmail, EmailAttachmentsTooLargeError } from "@/domain/email/send";
import { DocumentNotFoundError } from "@/domain/email/context";
import { MailNotConfiguredError } from "@/domain/email/settings";
import { EmailDocType, type SendEmailRawInput } from "@/schemas/email";
import { ToolError, type McpToolsContext, type Result } from "./context";

const QUOTE_KINDS = new Set(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA"]);
const INVOICE_KINDS = new Set(["INVOICE", "CREDIT_NOTE"]);

export function registerEmailTools(server: McpServer, ctx: McpToolsContext): void {
  // ── send_email ───────────────────────────────────────────────────────────────
  server.registerTool(
    "send_email",
    {
      title: "Beleg per E-Mail versenden",
      description:
        "Versendet einen Beleg (Angebot/AB/Proforma, Rechnung/Gutschrift, Lieferschein, Mahnung) per E-Mail. docId per Nummer oder ID. Betreff/Text/Empfaenger frei waehlbar (kein Vorlagenzwang) — templateId optional nur zur Protokollierung, welche Vorlage als Basis diente. Bei einem Rechnungs-/Gutschrift-Entwurf greift die Einstellung autoFinalizeOnSend (§33): ist sie aktiv, wird der Entwurf VOR dem Versand automatisch festgeschrieben; ist sie deaktiviert, wird der Entwurf unveraendert als Entwurf verschickt.",
      inputSchema: {
        docType: EmailDocType,
        docId: z.string().min(1).describe("Beleg-Nummer oder -ID"),
        to: z.array(z.string()).min(1).describe("Empfaenger-E-Mail-Adressen"),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(50000),
        signature: z.string().max(5000).optional(),
        copyToSelf: z.boolean().default(false),
        standardAttachments: z.array(z.string()).optional().describe("Dateinamen der Standardanhaenge (z. B. PDF/XRechnung), die mitgehen sollen"),
        attachmentIds: z.array(z.string()).optional().describe("IDs bestehender Beleganhaenge, die zusaetzlich mitgesendet werden sollen"),
        templateId: z.string().optional(),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        let docRef: { id: string };
        if (QUOTE_KINDS.has(args.docType)) docRef = await ctx.resolveDocument(org.id, args.docId);
        else if (INVOICE_KINDS.has(args.docType)) docRef = await ctx.resolveInvoice(org.id, args.docId);
        else if (args.docType === "DELIVERY_NOTE") docRef = await ctx.resolveDeliveryNote(org.id, args.docId);
        else docRef = await ctx.resolveDunning(org.id, args.docId);

        const rawInput: SendEmailRawInput = {
          docType: args.docType,
          docId: docRef.id,
          to: args.to.join(","),
          cc: (args.cc ?? []).join(","),
          bcc: (args.bcc ?? []).join(","),
          subject: args.subject,
          body: args.body,
          signature: args.signature ?? "",
          copyToSelf: args.copyToSelf,
          standardAttachments: args.standardAttachments ?? [],
          templateId: args.templateId,
          attachmentIds: args.attachmentIds ?? [],
          warnings: [],
        };
        const result = await sendDocumentEmail(org.id, "mcp", rawInput, [], ctx.mailProvider);
        if (result.status === "FAILED") return ctx.fail(result.error ?? "Versand fehlgeschlagen.");
        return ctx.ok(`E-Mail versendet (Log-ID ${result.logId}).`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof DocumentNotFoundError) return ctx.fail(e.message);
        if (e instanceof MailNotConfiguredError) return ctx.fail(e.message);
        if (e instanceof EmailAttachmentsTooLargeError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
