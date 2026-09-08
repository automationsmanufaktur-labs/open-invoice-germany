/**
 * Basis-URL der Instanz fuer oeffentliche Links (Angebotsannahme, Phase 3b).
 * `APP_BASE_URL` (optional, `.env.example`) hat Vorrang; ohne Env-Wert wird aus den
 * Request-Headern rekonstruiert (`x-forwarded-proto` + `host`, Fallback `https`).
 */
export function resolveBaseUrl(headers: Headers): string {
  const fromEnv = appBaseUrlFromEnv();
  if (fromEnv) return fromEnv;

  const host = headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/**
 * Nur `APP_BASE_URL`, ohne Header-Fallback — fuer Kontexte ohne Request (z. B.
 * `buildTemplateContext`, das auch aus Batch-/Cron-Pfaden ohne `headers()` aufgerufen
 * werden koennen soll). `null`, wenn die Variable nicht gesetzt ist (Ruling: "ohne Env
 * leer").
 */
export function appBaseUrlFromEnv(): string | null {
  const v = process.env.APP_BASE_URL?.trim();
  return v ? v.replace(/\/+$/, "") : null;
}
