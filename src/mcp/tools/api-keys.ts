// ── API-Schluessel (Phase 10, Task 1) ─────────────────────────────────────────
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createApiKey } from "@/domain/api-key/create";
import { revokeApiKey } from "@/domain/api-key/revoke";
import { listApiKeys } from "@/domain/api-key/list";
import { NotFoundError } from "@/domain/errors";
import { apiKeyScopeSchema } from "@/schemas";
import type { McpToolsContext, Result } from "./context";

export function registerApiKeyTools(server: McpServer, ctx: McpToolsContext): void {
  server.registerTool(
    "create_api_key",
    {
      title: "API-Schluessel erzeugen",
      description:
        "Erzeugt einen neuen API-Schluessel fuer /api/v1 (Phase 10). Das Klartext-Token wird NUR in dieser Antwort angezeigt — danach ist es nicht mehr abrufbar, nur der Praefix bleibt sichtbar (list_api_keys).",
      inputSchema: {
        name: z.string().min(1).max(80),
        scopes: z.array(apiKeyScopeSchema).min(1).describe("read/write/send/admin — mindestens einer"),
        expiresAt: z.string().datetime().optional().describe("ISO-8601, optional — ohne Angabe laeuft der Schluessel nie ab"),
      },
    },
    async ({ name, scopes, expiresAt }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const key = await createApiKey(org.id, { name, scopes, expiresAt: expiresAt ?? null }, "mcp");
        return ctx.ok(
          `API-Schluessel "${key.name}" erzeugt (Scopes: ${key.scopes.join(", ")}). Token (nur jetzt sichtbar): ${key.token}`,
        );
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        return ctx.failUnknown(e);
      }
    },
  );

  server.registerTool(
    "revoke_api_key",
    {
      title: "API-Schluessel widerrufen",
      description: "Widerruft einen API-Schluessel unwiderruflich (id aus list_api_keys). Bereits widerrufene Schluessel bleiben unveraendert (idempotent).",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        await revokeApiKey(org.id, id, "mcp");
        return ctx.ok(`API-Schluessel "${id}" widerrufen.`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  server.registerTool(
    "list_api_keys",
    {
      title: "API-Schluessel auflisten",
      description: "Listet alle API-Schluessel der Organisation (Name, Praefix, Scopes, zuletzt genutzt, Ablauf, Widerruf) — NIE das Klartext-Token.",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const { rows: keys } = await listApiKeys(org.id, { limit: 1000, offset: 0 });
        return ctx.ok(JSON.stringify(keys, null, 2));
      } catch (e) {
        return ctx.failUnknown(e);
      }
    },
  );
}
