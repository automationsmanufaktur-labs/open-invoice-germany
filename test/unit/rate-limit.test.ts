import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits, RateLimitError, debugRateLimitBucketCount } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("erlaubt genau `limit` Aufrufe, der naechste wirft", () => {
    const key = "test-key";
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(() => rateLimit(key, { limit: 10, windowMs: 60_000, now })).not.toThrow();
    }
    expect(() => rateLimit(key, { limit: 10, windowMs: 60_000, now })).toThrow(RateLimitError);
  });

  it("erlaubt nach Ablauf des Fensters wieder Aufrufe", () => {
    const key = "test-key-2";
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      rateLimit(key, { limit: 10, windowMs: 60_000, now });
    }
    expect(() => rateLimit(key, { limit: 10, windowMs: 60_000, now })).toThrow(RateLimitError);

    const later = now + 60_000;
    expect(() => rateLimit(key, { limit: 10, windowMs: 60_000, now: later })).not.toThrow();
  });

  it("nennt die verbleibende Wartezeit im Fehler", () => {
    const key = "test-key-3";
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      rateLimit(key, { limit: 10, windowMs: 60_000, now });
    }
    try {
      rateLimit(key, { limit: 10, windowMs: 60_000, now: now + 100 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterMs).toBe(60_000 - 100);
    }
  });

  it("behandelt unterschiedliche Schluessel unabhaengig voneinander", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      rateLimit("key-a", { limit: 10, windowMs: 60_000, now });
    }
    expect(() => rateLimit("key-b", { limit: 10, windowMs: 60_000, now })).not.toThrow();
  });

  // Task-1-Review-Auflage: der Cleanup-Zaehler muss auch im Ablehnungspfad (throw)
  // erhoeht werden — sonst waechst die Map bei ausschliesslich abgewiesenem Traffic
  // (z. B. ein Angriff mit vielen verschiedenen Schluesseln) unbegrenzt, weil cleanup()
  // nie ausgeloest wird. limit: 0 -> jeder Aufruf wird sofort abgelehnt; `now` wandert
  // pro Aufruf weiter, sodass fruehere Buckets beim Cleanup laengst abgelaufen sind.
  it("erhoeht den Cleanup-Zaehler auch bei Ablehnung, damit die Map bei reinem Ablehnungs-Traffic nicht unbegrenzt waechst", () => {
    const base = 1_000_000;
    const windowMs = 100;
    for (let i = 0; i < 150; i++) {
      const key = `rejected-${i}`;
      expect(() => rateLimit(key, { limit: 0, windowMs, now: base + i * 50 })).toThrow(RateLimitError);
    }
    // Ohne die Korrektur waeren hier 150 Eintraege im Speicher (Cleanup wurde nie
    // erreicht). Mit der Korrektur greift cleanup() bereits nach 100 Aufrufen und
    // entfernt die zu diesem Zeitpunkt laengst abgelaufenen frueheren Schluessel.
    expect(debugRateLimitBucketCount()).toBeLessThan(150);
  });
});
