/**
 * I3 (Abschluss-Review) — `newLineKey()` (`src/lib/editor/ids.ts`) faellt auf
 * `crypto.getRandomValues` zurueck, wenn `crypto.randomUUID` fehlt (Nicht-Secure-Context,
 * z. B. eine selbst-gehostete Instanz per HTTP ueber eine LAN-Adresse — dort ist
 * `crypto.randomUUID` im Browser `undefined`, `crypto.getRandomValues` bleibt verfuegbar).
 *
 * `crypto.randomUUID` haengt in Node (und den meisten Browsern) an `Crypto.prototype`,
 * nicht als eigene Eigenschaft auf `crypto` selbst (`Object.hasOwnProperty` liefert
 * `false`) — ein simples `delete crypto.randomUUID` entfernt daher NICHTS (die Methode
 * bleibt ueber die Prototypenkette sichtbar). Zum Testen des Fallback-Pfads wird die
 * Methode stattdessen mit einer eigenen Eigenschaft ueberdeckt
 * (`Object.defineProperty(crypto, "randomUUID", { value: undefined, ... })`) und danach
 * per `delete` wieder entfernt (die Ueberdeckung faellt weg, das Original auf dem
 * Prototyp wird wieder sichtbar).
 */
import { describe, it, expect } from "vitest";
import { newLineKey } from "@/lib/editor/ids";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function withoutRandomUUID<T>(fn: () => T): T {
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    return fn();
  } finally {
    // Entfernt die Ueberdeckung wieder — `crypto.randomUUID` zeigt danach wieder auf die
    // urspruengliche (Prototyp-)Methode, kein manuelles Zwischenspeichern/Zuruecksetzen
    // eines Funktionswerts noetig.
    delete (crypto as { randomUUID?: unknown }).randomUUID;
  }
}

describe("editor/ids", () => {
  it("nutzt crypto.randomUUID(), wenn verfuegbar", () => {
    const key = newLineKey();
    expect(key).toMatch(UUID_RE);
  });

  it("faellt auf crypto.getRandomValues zurueck, wenn crypto.randomUUID fehlt (Nicht-Secure-Context)", () => {
    const key = withoutRandomUUID(() => newLineKey());
    expect(key.startsWith("l")).toBe(true);
    expect(key).not.toMatch(UUID_RE);
    // "l" + Date.now() (Ziffern) + 16 Hex-Zeichen (8 Byte crypto.getRandomValues).
    expect(key).toMatch(/^l\d+[0-9a-f]{16}$/);
  });

  it("liefert bei wiederholten Aufrufen eindeutige Schluessel — auch im Fallback-Pfad", () => {
    const keys = withoutRandomUUID(() => new Set(Array.from({ length: 20 }, () => newLineKey())));
    expect(keys.size).toBe(20);
  });

  it("ruft im Fallback-Pfad tatsaechlich crypto.getRandomValues auf (kein Math.random)", () => {
    const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
    let called = false;
    crypto.getRandomValues = ((arr: Parameters<Crypto["getRandomValues"]>[0]) => {
      called = true;
      return originalGetRandomValues(arr);
    }) as typeof crypto.getRandomValues;
    try {
      withoutRandomUUID(() => newLineKey());
      expect(called).toBe(true);
    } finally {
      crypto.getRandomValues = originalGetRandomValues;
    }
  });
});
