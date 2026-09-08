/**
 * Zod-Schemas fuer API-Schluessel (Phase 10, Task 1, §55: Zod an jeder Boundary —
 * Session-Routen UND MCP-Tools nutzen dieselben Schemas wie die Domain-Funktionen).
 */
import { z } from "zod";

export const API_KEY_SCOPES = ["read", "write", "send", "admin"] as const;
export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const createApiKeyInputSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(apiKeyScopeSchema).min(1, "Mindestens ein Scope erforderlich."),
  // ISO-8601 — optional, kein Ablauf wenn weggelassen/null.
  expiresAt: z.string().datetime().optional().nullable(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;
