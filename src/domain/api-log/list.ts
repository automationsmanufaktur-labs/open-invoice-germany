/**
 * Liest Eintraege des Anfrageprotokolls (Phase 12d, Task 2) — Listenfilter + Einzelabruf.
 * Nach dem Vorbild von src/domain/email/log-list.ts (dort `prisma`); hier ueber
 * `dbInternal`, wie die uebrigen Funktionen dieses Domains (`settings.ts`, `write.ts`,
 * `purge.ts`) — der GoBD-Guard in src/lib/db.ts betrifft ApiRequestLog ohnehin nicht.
 * `path`-Filter nutzt den portablen `ciContains`-Helfer aus src/lib/db.ts statt eines
 * rohen `{ contains }`, damit die Suche auf SQLite UND Postgres gleich funktioniert.
 *
 * Task-5-Review-Nachtrag: die LISTE laedt bewusst OHNE `requestBody`/`responseBody`
 * (per `select`) — eine Liste kann bis zu 200 Zeilen umfassen, jede davon bis zu 2 KB
 * Body mitzuladen waere unnoetiger Datentransfer fuer eine Uebersicht, die ohnehin nur
 * Kopfdaten anzeigt (Tabelle in ApiRequestLogPanel.tsx). Volle Bodies gibt es nur ueber
 * den Einzelabruf (`findApiRequestLog`, Detail-Schublade).
 */
import { ciContains, dbInternal } from "@/lib/db";
import { apiRequestLogFilterSchema } from "@/schemas/api-log";
import type { ApiRequestLog } from "@/generated/prisma/client";

/** Listenzeile OHNE Bodies — siehe Modulkommentar. */
export type ApiRequestLogListRow = Omit<ApiRequestLog, "requestBody" | "responseBody">;

export interface ApiRequestLogListResult {
  rows: ApiRequestLogListRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function listApiRequestLogs(orgId: string, rawFilter: unknown): Promise<ApiRequestLogListResult> {
  const filter = apiRequestLogFilterSchema.parse(rawFilter);
  const where = {
    orgId,
    ...(filter.apiKeyId ? { apiKeyId: filter.apiKeyId } : {}),
    ...(filter.errorsOnly ? { status: { gte: 400 } } : {}),
    ...(filter.path ? { path: ciContains(filter.path) } : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    dbInternal.apiRequestLog.count({ where }),
    dbInternal.apiRequestLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: {
        id: true,
        orgId: true,
        apiKeyId: true,
        requestId: true,
        method: true,
        path: true,
        query: true,
        status: true,
        durationMs: true,
        errorCode: true,
        ip: true,
        userAgent: true,
        bodyTruncated: true,
        createdAt: true,
      },
    }),
  ]);
  return { rows, total, limit: filter.limit, offset: filter.offset };
}

/** Voller Datensatz (inkl. Bodies) — nur fuer den Einzelabruf (Detail-Schublade/REST-`{id}`).
 *  Abschluss-Review Fix-Welle (m6, final-review.md): expliziter `select` ueber ALLE
 *  heutigen Spalten statt eines impliziten Voll-Selects — ein kuenftig neu hinzukommendes
 *  Feld landet dann nicht automatisch (und unbemerkt) in dieser Antwort. */
export async function findApiRequestLog(orgId: string, id: string): Promise<ApiRequestLog | null> {
  return dbInternal.apiRequestLog.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      orgId: true,
      apiKeyId: true,
      requestId: true,
      method: true,
      path: true,
      query: true,
      status: true,
      durationMs: true,
      errorCode: true,
      ip: true,
      userAgent: true,
      requestBody: true,
      responseBody: true,
      bodyTruncated: true,
      createdAt: true,
    },
  });
}
