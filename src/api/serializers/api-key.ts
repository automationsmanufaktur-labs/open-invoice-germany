import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { ApiKeySummary } from "@/domain/api-key/list";
import { z } from "zod";

/** Nie Token/Hash (siehe listApiKeys) — nur Metadaten. */
export function serializeApiKey(k: ApiKeySummary) {
  return {
    objectName: "ApiKey" as const,
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    lastUsedAt: iso(k.lastUsedAt),
    expiresAt: iso(k.expiresAt),
    revokedAt: iso(k.revokedAt),
    createdAt: iso(k.createdAt),
  };
}


/**
 * OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeApiKey abgeleitet. KEIN
 * `objectName`-Feld (siehe serializeApiKey — Abweichung von der sonstigen Konvention,
 * unveraendert aus Task 2 uebernommen, nicht Teil dieses Tasks).
 */
export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});
