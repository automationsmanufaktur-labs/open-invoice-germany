// ── Beleganhaenge ──────────────────────────────────────────────────────────────
// Task 1 (Phase 9): reiner Move aus server.ts — Verhalten unveraendert.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { addAttachment, removeAttachment, listAttachments } from "@/domain/attachment/manage";
import { AttachmentValidationError } from "@/lib/attachments/storage";
import { MAX_ATTACHMENT_FILE_BYTES } from "@/lib/attachments/mime";
import { NotFoundError } from "@/domain/errors";
import { DocRefType } from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

export function registerAttachmentTools(server: McpServer, ctx: McpToolsContext): void {
  // ── add_attachment ───────────────────────────────────────────────────────────
  server.registerTool(
    "add_attachment",
    {
      title: "Beleganhang hochladen",
      description:
        "Fuegt einem Beleg (Rechnung/Angebot/Lieferschein/Abo/Mahnung) einen Anhang hinzu. Dateiinhalt als Base64. Gleiche Grenzen/Whitelist wie im UI (10 MB je Datei, 50 MB je Beleg, keine ausfuehrbaren Formate, Magic-Bytes-Pruefung).",
      inputSchema: {
        docType: DocRefType,
        docId: z.string().describe("Belegnummer oder ID"),
        filename: z.string(),
        mime: z.string().describe("MIME-Typ, z. B. application/pdf"),
        contentBase64: z.string().describe("Dateiinhalt Base64-kodiert"),
      },
    },
    async (args): Promise<Result> => {
      try {
        // G2: Base64-Laenge VOR dem Dekodieren gegen die Datei-Obergrenze pruefen — ein
        // riesiger Base64-String wuerde sonst erst vollstaendig in einen Buffer dekodiert
        // (bis zu ~33 % groesser im Speicher) und danach ERST von addAttachment abgelehnt.
        // Base64 kodiert 3 Rohbytes in 4 Zeichen -> max. zulaessige Zeichenlaenge =
        // ceil(MAX_BYTES * 4/3) + 4 (Puffer fuer Padding/Zeilenumbrueche).
        const maxBase64Length = Math.ceil((MAX_ATTACHMENT_FILE_BYTES * 4) / 3) + 4;
        if (args.contentBase64.length > maxBase64Length) {
          return ctx.fail(`Anhang ueberschreitet die Groesse von ${MAX_ATTACHMENT_FILE_BYTES / (1024 * 1024)} MB.`);
        }
        const org = await ctx.requireOrg();
        const doc = await ctx.resolveDocForAttachment(org.id, args.docType, args.docId);
        const buffer = Buffer.from(args.contentBase64, "base64");
        const row = await addAttachment(org.id, args.docType, doc.id, { filename: args.filename, mime: args.mime, buffer }, "mcp");
        return ctx.ok(`Anhang gespeichert: ${row.filename} (${(row.sizeBytes / 1024).toFixed(0)} KB). ID: ${row.id}.`);
      } catch (e) {
        if (e instanceof AttachmentValidationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_attachments ─────────────────────────────────────────────────────────
  server.registerTool(
    "list_attachments",
    {
      title: "Beleganhaenge auflisten",
      description: "Listet die Anhaenge eines Belegs.",
      inputSchema: {
        docType: DocRefType,
        docId: z.string().describe("Belegnummer oder ID"),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const doc = await ctx.resolveDocForAttachment(org.id, args.docType, args.docId);
        const rows = await listAttachments(org.id, args.docType, doc.id);
        if (rows.length === 0) return ctx.ok("Keine Anhaenge.");
        return ctx.ok(
          JSON.stringify(
            rows.map((r) => ({ id: r.id, filename: r.filename, mime: r.mime, sizeBytes: r.sizeBytes, uploadedAt: r.createdAt.toISOString() })),
            null,
            2,
          ),
        );
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── remove_attachment ────────────────────────────────────────────────────────
  server.registerTool(
    "remove_attachment",
    {
      title: "Beleganhang entfernen",
      description: "Entfernt einen Anhang von einem Beleg (kein GoBD-Beleg — die Datei ist loeschbar, die Aktion geht ins ChangeLog).",
      inputSchema: {
        docType: DocRefType,
        docId: z.string().describe("Belegnummer oder ID"),
        attachmentId: z.string(),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const doc = await ctx.resolveDocForAttachment(org.id, args.docType, args.docId);
        await removeAttachment(org.id, args.docType, doc.id, args.attachmentId, "mcp");
        return ctx.ok(`Anhang ${args.attachmentId} entfernt.`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
