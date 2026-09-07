#!/usr/bin/env node
/**
 * OpenInvoice Germany — MCP-Server.
 *
 * Macht die Rechnungssoftware per natürlicher Sprache steuerbar (Claude Code /
 * Claude Desktop). Die Tools setzen auf den GoBD-/EN-16931-gehärteten Domain-Kern
 * auf — das Festschreiben erzwingt die § 14-Pflichtangaben, festgeschriebene
 * Rechnungen sind unveränderbar. Keine Cloud, alles lokal.
 *
 * Start: npm run mcp   (oder via Claude-Code-MCP-Konfiguration, siehe README)
 *
 * Phase 9, Task 1: Aufteilung der frueher ~2700 Zeilen langen Tool-Registrierung in
 * Bereichs-Module unter src/mcp/tools/*.ts (register<Bereich>Tools(server, ctx)) —
 * reiner Move, Verhalten identisch. `server` bleibt hier exportiert (bestehende
 * Integrationstests greifen ueber server["_registeredTools"][name].handler zu),
 * ebenso `buildSimpleLines` (jetzt aus ./tools/context re-exportiert). `mcpContext`
 * ist zusaetzlich exportiert, damit Tests send_email einen Test-MailProvider injizieren
 * koennen (mcpContext.mailProvider = fakeProvider), ohne echtes SMTP/Mailcow zu brauchen.
 */
import "./bootstrap";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createDefaultContext, buildSimpleLines } from "./tools/context";
import { registerSystemTools } from "./tools/system";
import { registerCustomerTools } from "./tools/customers";
import { registerProductTools } from "./tools/products";
import { registerInvoiceTools } from "./tools/invoices";
import { registerDocumentTools } from "./tools/documents";
import { registerPaymentTools } from "./tools/payments";
import { registerDunningTools } from "./tools/dunning";
import { registerEmailTools } from "./tools/email";
import { registerAttachmentTools } from "./tools/attachments";
import { registerSettingsTools } from "./tools/settings";
import { registerRecurringTools } from "./tools/recurring";
import { registerSchedulerTools } from "./tools/scheduler";
import { registerApiKeyTools } from "./tools/api-keys";
import { registerWebhookTools } from "./tools/webhooks";

// Exportiert fuer Integrationstests (test/integration/mcp-*.test.ts): erlaubt,
// registrierte Tool-Handler direkt aufzurufen, ohne einen Stdio-Transport zu starten.
export const server = new McpServer({ name: "open-invoice-germany", version: "0.1.0" });

// Re-Export fuer bestehende Tests (test/integration/mcp-server.test.ts importiert
// buildSimpleLines direkt aus "@/mcp/server").
export { buildSimpleLines };

// Exportiert fuer Tests: send_email liest ctx.mailProvider bei JEDEM Aufruf frisch (kein
// destructuring beim Registrieren) — ein Test kann also vor dem Aufruf
// mcpContext.mailProvider setzen, ohne den Server neu aufzubauen.
export const mcpContext = createDefaultContext();

registerSystemTools(server, mcpContext);
registerCustomerTools(server, mcpContext);
registerProductTools(server, mcpContext);
registerInvoiceTools(server, mcpContext);
registerDocumentTools(server, mcpContext);
registerPaymentTools(server, mcpContext);
registerDunningTools(server, mcpContext);
registerEmailTools(server, mcpContext);
registerAttachmentTools(server, mcpContext);
registerSettingsTools(server, mcpContext);
registerRecurringTools(server, mcpContext);
registerSchedulerTools(server, mcpContext);
registerApiKeyTools(server, mcpContext);
registerWebhookTools(server, mcpContext);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr, damit stdout dem JSON-RPC vorbehalten bleibt
  console.error("[open-invoice-germany] MCP-Server bereit (stdio).");
}

// Nur starten, wenn direkt ausgeführt (nicht beim Import in Unit-Tests).
const isEntrypoint = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isEntrypoint) {
  main().catch((e) => {
    console.error("[open-invoice-germany] Fehler:", e);
    process.exit(1);
  });
}
