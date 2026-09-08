/**
 * Zod-Schemas fuer das Anfrageprotokoll der REST-API (Phase 12d, Task 1) — Einstellungen
 * (ApiSettings, standardmaessig AUS) und Listenfilter (GET-Query, ApiRequestLog).
 */
import { z } from "zod";

export const apiSettingsInputSchema = z.object({
  logRequests: z.boolean().default(false),
  logBodies: z.boolean().default(false),
  retentionDays: z.coerce.number().int().min(1).max(90).default(7),
  maxRows: z.coerce.number().int().min(100).max(20000).default(2000),
});
export type ApiSettingsInput = z.infer<typeof apiSettingsInputSchema>;

export const apiRequestLogFilterSchema = z.object({
  apiKeyId: z.string().min(1).optional(),
  // Fix-Welle (I3, final-review.md): z.coerce.boolean() machte aus JEDEM nicht-leeren
  // String true — "errorsOnly=false" wurde faelschlich zu true. Dieses Schema ist zugleich
  // die Boundary der OEFFENTLICHEN REST-Ressource (GET /api/v1/ApiRequestLog, Query-String
  // -> immer ein String) UND des MCP-Tools (dessen Aufrufer echte Booleans schicken kann) —
  // ein expliziter Union statt Coerce deckt beide Faelle korrekt ab.
  errorsOnly: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
  path: z.string().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
// Fix-Welle (m7): kein `ApiRequestLogFilter`-Typalias mehr — wurde nirgends im Repo
// verwendet (weder innerhalb noch ausserhalb dieses Moduls); `z.infer<typeof
// apiRequestLogFilterSchema>` laesst sich bei Bedarf jederzeit direkt an der Aufrufstelle bilden.
