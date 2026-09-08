/**
 * Serialisierer fuer die REST-Ressource `ApiRequestLog` (Phase 12d, Task 5) — nach dem
 * Vorbild von `email-log.ts` (ebenfalls nur GET). `serializeApiRequestLog` akzeptiert
 * ZWEI Zeilenformen: den vollen Prisma-Datensatz (`findApiRequestLog`, Einzelabruf inkl.
 * Bodies) UND die bodylose Listenzeile (`listApiRequestLogs#ApiRequestLogListRow`,
 * `src/domain/api-log/list.ts`) — bei Letzterer liefert die Antwort `requestBody`/
 * `responseBody` als `null`, statt die Felder wegzulassen (stabile Antwortform fuer
 * Client-Code, unabhaengig davon, ob es sich um eine Listen- oder Einzelantwort handelt).
 * `orgId` erscheint bewusst NICHT im Antwortobjekt (Muster wie bei jeder anderen
 * Ressource — die Organisation folgt bereits aus dem API-Schluessel).
 */
import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { z } from "zod";
import { iso } from "./common";
import type { ApiRequestLog } from "@/generated/prisma/client";
import type { ApiRequestLogListRow } from "@/domain/api-log/list";

type ApiRequestLogRow = ApiRequestLog | ApiRequestLogListRow;

function hasBodies(row: ApiRequestLogRow): row is ApiRequestLog {
  return "requestBody" in row;
}

export function serializeApiRequestLog(l: ApiRequestLogRow) {
  return {
    objectName: "ApiRequestLog" as const,
    id: l.id,
    apiKeyId: l.apiKeyId,
    requestId: l.requestId,
    method: l.method,
    path: l.path,
    query: l.query,
    status: l.status,
    durationMs: l.durationMs,
    errorCode: l.errorCode,
    ip: l.ip,
    userAgent: l.userAgent,
    requestBody: hasBodies(l) ? l.requestBody : null,
    responseBody: hasBodies(l) ? l.responseBody : null,
    bodyTruncated: l.bodyTruncated,
    createdAt: iso(l.createdAt),
  };
}

/** OpenAPI-Response-Schema (Phase 10, Task 4-Muster) — aus serializeApiRequestLog abgeleitet. */
export const apiRequestLogSchema = z.object({
  objectName: z.literal("ApiRequestLog"),
  id: z.string(),
  apiKeyId: z.string().nullable(),
  requestId: z.string(),
  method: z.string(),
  path: z.string(),
  query: z.string().nullable(),
  status: z.number().int(),
  durationMs: z.number().int(),
  errorCode: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseBody: z.string().nullable(),
  bodyTruncated: z.boolean(),
  createdAt: z.string().nullable(),
});
