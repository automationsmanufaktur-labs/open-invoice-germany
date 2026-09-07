/**
 * In-Memory-Rate-Limit (Token-Bucket, fenster-basiert) fuer oeffentliche Routen
 * ohne Authentifizierung — z.B. den Angebotsannahme-Link (Phase 3b).
 *
 * Bewusst kein Redis/Datenbank-Backend: Single-Instance-Deployment (siehe
 * ARCHITEKTUR.md), der Zustand darf beim Neustart verloren gehen. Die Map lebt
 * im Modulscope und wird ueber alle Aufrufe des Prozesses geteilt.
 */

export class RateLimitError extends Error {
  /** Millisekunden, nach denen ein erneuter Versuch wieder erlaubt ist. */
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate-Limit ueberschritten — erneut in ${retryAfterMs}ms versuchen.`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

interface Bucket {
  /** Verbleibende Aufrufe im aktuellen Fenster. */
  tokens: number;
  /** Startzeitpunkt des aktuellen Fensters (epoch ms). */
  windowStart: number;
}

interface RateLimitOptions {
  /** Maximal erlaubte Aufrufe pro Fenster. */
  limit: number;
  /** Fensterlaenge in Millisekunden. */
  windowMs: number;
  /** Injizierbarer Zeitpunkt fuer Tests; Standard: Date.now(). */
  now?: number;
}

const buckets = new Map<string, Bucket>();

// Zaehlt Aufrufe seit dem letzten Aufraeumen — verhindert, dass jeder Aufruf
// die gesamte Map durchsucht.
let callsSinceCleanup = 0;
const CLEANUP_INTERVAL = 100;

/**
 * Prueft und verbraucht ein Kontingent fuer `key`. Wirft `RateLimitError`, wenn
 * das Kontingent im aktuellen Fenster erschoepft ist.
 */
export function rateLimit(key: string, options: RateLimitOptions): void {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { tokens: limit, windowStart: now };
    buckets.set(key, bucket);
  }

  if (bucket.tokens <= 0) {
    const retryAfterMs = windowMs - (now - bucket.windowStart);
    // Zaehler auch im Ablehnungspfad erhoehen — sonst waechst die Map bei
    // ausschliesslich abgewiesenem Traffic (z.B. Angriff) unbegrenzt, weil
    // cleanup() nie ausgeloest wird.
    callsSinceCleanup += 1;
    if (callsSinceCleanup >= CLEANUP_INTERVAL) {
      callsSinceCleanup = 0;
      cleanup(now, windowMs);
    }
    throw new RateLimitError(Math.max(retryAfterMs, 0));
  }

  bucket.tokens -= 1;

  callsSinceCleanup += 1;
  if (callsSinceCleanup >= CLEANUP_INTERVAL) {
    callsSinceCleanup = 0;
    cleanup(now, windowMs);
  }
}

/** Entfernt Eintraege, deren Fenster laengst abgelaufen ist. */
function cleanup(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

/** Nur fuer Tests: setzt den gesamten In-Memory-Zustand zurueck. */
export function resetRateLimits(): void {
  buckets.clear();
  callsSinceCleanup = 0;
}

/** Nur fuer Tests: Anzahl der aktuell im Speicher gehaltenen Schluessel. */
export function debugRateLimitBucketCount(): number {
  return buckets.size;
}
