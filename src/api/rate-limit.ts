/**
 * Rate-Limit fuer /api/v1/* (Phase 10, Task 1, task-1-facts.md): 600 Anfragen/min je
 * API-Schluessel, wiederverwendet aus src/lib/rate-limit.ts (Phase 3b). Schluessel
 * `apikey:<id>` — getrennt vom Namensraum der oeffentlichen Routen (`public:*`,
 * `decide:*`, `pdf:*`), damit sich Kontingente nicht ueberschneiden.
 *
 * Fix-Welle (Should-fix 4): das obige Kontingent greift erst NACH `verifyApiToken` —
 * jede Anfrage mit fehlendem/ungueltigem Bearer-Token verbrauchte bisher gar kein
 * Kontingent und loeste trotzdem einen DB-Lookup aus (`apiKey.findUnique`), was hinter
 * Cloudflare einen unbegrenzten DB-Round-Trip-Verstaerker fuer einen Angreifer darstellt.
 * `checkPreAuthRateLimit` laeuft deshalb VOR `verifyApiToken` (src/api/auth.ts), gekeyt
 * auf die Client-IP (dieselbe Kopfzeilen-Reihenfolge wie Phase 3b,
 * src/lib/http/client-ip.ts) statt auf den (noch unbekannten) Schluessel — ein eigener
 * Namensraum `preauth:*`, getrennt von `apikey:*`.
 */
import { NextResponse } from "next/server";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";

export const API_RATE_LIMIT = 600;
export const API_RATE_WINDOW_MS = 60_000;

export const PRE_AUTH_RATE_LIMIT = 120;
export const PRE_AUTH_RATE_WINDOW_MS = 60_000;

/** Verbraucht ein Kontingent fuer den API-Schluessel; wirft RateLimitError bei Ueberschreitung. */
export function checkApiRateLimit(apiKeyId: string): number {
  return rateLimit(`apikey:${apiKeyId}`, { limit: API_RATE_LIMIT, windowMs: API_RATE_WINDOW_MS });
}

/** Verbraucht ein IP-gekeytes Kontingent VOR der Token-Pruefung; wirft RateLimitError
 *  bei Ueberschreitung. `ip === null` (kein Proxy-Header) teilt sich einen gemeinsamen
 *  Fallback-Schluessel — besser als ungebremst, auch wenn dann grober granuliert. */
export function checkPreAuthRateLimit(ip: string | null): number {
  return rateLimit(`preauth:${ip ?? "unknown"}`, { limit: PRE_AUTH_RATE_LIMIT, windowMs: PRE_AUTH_RATE_WINDOW_MS });
}

export function attachRateLimitHeader(res: NextResponse, remaining: number): NextResponse {
  res.headers.set("X-RateLimit-Remaining", String(Math.max(remaining, 0)));
  return res;
}

export { RateLimitError };
