/**
 * Fix-Welle Phase 11c, I3 — Zeilen-Schluessel fuer den Beleg-Editor. `crypto.randomUUID()`
 * ist im Browser NUR im Secure Context verfuegbar (HTTPS oder `localhost`); eine
 * selbst-gehostete Instanz, die per HTTP ueber eine LAN-/Reverse-Proxy-Adresse aufgerufen
 * wird (reales docker-compose-Setup ohne TLS), liefert dort `undefined` — Hydration wirft
 * dann `TypeError: crypto.randomUUID is not a function` und der Editor ist tot.
 *
 * `newLineKey()` faellt in diesem Fall auf `crypto.getRandomValues` zurueck (KEIN
 * `Math.random()` — auch als reiner UI-Schluessel soll kein schwacher Zufallsgenerator
 * verwendet werden, wenn ein kryptographischer verfuegbar ist). Diese Keys muessen nur
 * innerhalb EINER Zeilenliste eindeutig sein, keine global eindeutige ID im DB-Sinn.
 */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newLineKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback fuer Nicht-Secure-Contexts (kein `crypto.randomUUID`), aber `crypto.getRandomValues`
  // ist auch dort verfuegbar (Teil von `SubtleCrypto`-unabhaengigem `Crypto`-Interface).
  return `l${Date.now()}${randomHex(8)}`;
}
