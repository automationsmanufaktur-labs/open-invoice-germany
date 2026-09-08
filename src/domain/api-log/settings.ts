/**
 * Org-weite Einstellungen fuer das Anfrageprotokoll der REST-API (Phase 12d, Task 1):
 * ob Anfragen ueberhaupt protokolliert werden (`logRequests`, Default AUS), ob dabei
 * auch Request-/Response-Bodies gespeichert werden (`logBodies`), Aufbewahrung
 * (`retentionDays`) und Obergrenze der Zeilen je Organisation (`maxRows`). Ohne
 * gespeicherte Zeile gelten die Defaults — keine Migration noetig, bevor eine
 * Organisation die Einstellungen zum ersten Mal oeffnet (Selbstheilung wie
 * src/domain/document/settings.ts).
 *
 * Abschluss-Review Fix-Welle (m1, final-review.md): `loadApiSettings` laeuft im
 * `withApi`-Hook auf JEDER authentifizierten `/api/v1/*`-Anfrage — auch wenn das
 * Protokoll aus ist (Default). Ein winziger Prozess-Cache je `orgId` mit kurzer TTL
 * erspart den zusaetzlichen `findUnique` fuer den ueberwiegenden Fall; `saveApiSettings`
 * invalidiert den Eintrag sofort, eine Aenderung ist also spaetestens beim naechsten
 * Aufruf sichtbar (nie erst nach TTL-Ablauf).
 */
import { dbInternal } from "@/lib/db";
import { apiSettingsInputSchema, type ApiSettingsInput } from "@/schemas/api-log";

export const DEFAULT_API_SETTINGS: ApiSettingsInput = apiSettingsInputSchema.parse({});

const CACHE_TTL_MS = 8000;
const cache = new Map<string, { settings: ApiSettingsInput; expiresAt: number }>();

/** Laedt die API-Protokoll-Einstellungen einer Organisation; Defaults, wenn noch keine Zeile existiert. */
export async function loadApiSettings(orgId: string): Promise<ApiSettingsInput> {
  const now = Date.now();
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.settings;

  const row = await dbInternal.apiSettings.findUnique({
    where: { orgId },
    select: { logRequests: true, logBodies: true, retentionDays: true, maxRows: true },
  });
  const settings = row ? apiSettingsInputSchema.parse(row) : DEFAULT_API_SETTINGS;
  cache.set(orgId, { settings, expiresAt: now + CACHE_TTL_MS });
  return settings;
}

/** Speichert die API-Protokoll-Einstellungen (Upsert, da anfangs keine Zeile existiert). */
export async function saveApiSettings(orgId: string, raw: unknown): Promise<ApiSettingsInput> {
  const input = apiSettingsInputSchema.parse(raw);
  await dbInternal.apiSettings.upsert({
    where: { orgId },
    create: { orgId, ...input },
    update: { ...input },
    select: { id: true },
  });
  cache.delete(orgId);
  return input;
}
