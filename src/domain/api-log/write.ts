/**
 * Schreibt einen Eintrag des Anfrageprotokolls (Phase 12d, Task 2). Die Einstellungen der
 * Organisation laedt der Aufrufer (`withApi`, src/api/auth.ts) EINMAL und reicht sie hier
 * herein — Task-5-Review-Nachtrag: ein zweiter `loadApiSettings`-Aufruf innerhalb dieser
 * Funktion war ein unnoetiger doppelter DB-Roundtrip je Anfrage. Ohne `logRequests` oder
 * fuer ausgeschlossene Pfade (Doku, OpenAPI, ping, das Protokoll selbst — `shouldLogPath`)
 * wird nichts geschrieben. Bodies werden nur bei `logBodies` gespeichert — der Request-Body
 * wird dann immer versucht, der Response-Body nur, wenn der Aufrufer einen mitgegeben hat
 * UND `input.status >= 400` (defensive Doppelpruefung: `withApi` haelt die Regel "Response-
 * Body nur bei Fehlern" bereits selbst ein, hier zusaetzlich erzwungen, falls ein
 * kuenftiger Aufrufer das vergisst). Protokollieren darf eine Anfrage nie zum Scheitern
 * bringen — die Funktion wirft nie, ein Fehlschlag landet stattdessen einmalig auf
 * `console.error`.
 */
import { dbInternal } from "@/lib/db";
import type { ApiSettingsInput } from "@/schemas/api-log";
import { prepareBody, shouldLogPath } from "./redact";

export interface ApiLogInput {
  orgId: string;
  apiKeyId: string | null;
  requestId: string;
  method: string;
  path: string;
  query: string | null;
  status: number;
  durationMs: number;
  errorCode: string | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: string | null; // roher Text, noch ungekuerzt
  responseBody: string | null; // nur vom Aufrufer gesetzt, wenn status >= 400
}

export async function logApiRequest(input: ApiLogInput, settings: ApiSettingsInput): Promise<void> {
  try {
    if (!settings.logRequests) return;
    if (!shouldLogPath(input.path)) return;

    let requestBody: string | null = null;
    let responseBody: string | null = null;
    let bodyTruncated = false;
    if (settings.logBodies) {
      const req = prepareBody(input.requestBody);
      requestBody = req.text;
      bodyTruncated = bodyTruncated || req.truncated;
      if (input.responseBody != null && input.status >= 400) {
        const res = prepareBody(input.responseBody);
        responseBody = res.text;
        bodyTruncated = bodyTruncated || res.truncated;
      }
    }

    await dbInternal.apiRequestLog.create({
      data: {
        orgId: input.orgId,
        apiKeyId: input.apiKeyId,
        requestId: input.requestId,
        method: input.method,
        path: input.path,
        query: input.query,
        status: input.status,
        durationMs: input.durationMs,
        errorCode: input.errorCode,
        ip: input.ip,
        userAgent: input.userAgent,
        requestBody,
        responseBody,
        bodyTruncated,
      },
      select: { id: true },
    });
  } catch (e) {
    // Protokollieren darf die Anfrage nie kippen — der Fehlschlag landet trotzdem
    // einmalig im Server-Log, statt still zu verschwinden (Task-5-Review-Nachtrag).
    console.error("logApiRequest fehlgeschlagen:", e);
  }
}
