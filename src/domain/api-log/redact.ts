/**
 * Reine Helfer fuer das Anfrageprotokoll (Phase 12d) — kein DB-Zugriff, kein Request:
 * Schwaerzen verdaechtiger JSON-Schluessel (Bodies UND Query-Parameter), Kuerzen auf 2 KB,
 * Ausschluss der Pfade, die nichts zum Debuggen beitragen (Doku/OpenAPI/ping) oder eine
 * Rekursion ausloesen wuerden (die Protokoll-Route selbst). Der Authorization-HEADER wird
 * nirgends gespeichert — er kommt gar nicht erst in diese Datei; das Muster deckt nur ein
 * gleichnamiges JSON-Feld bzw. einen gleichnamigen Query-Parameter ab.
 *
 * Abschluss-Review Fix-Welle (C1/I1/I2, final-review.md): `prepareBody` kuerzte vorher
 * ZEICHENweise gegen die Byte-Grenze (ein `Buffer.byteLength`-Aufruf PRO Zeichen) — O(n²),
 * bei einem 2-MB-Body ca. 75 Sekunden Event-Loop-Blockade. Jetzt: (1) ein 256-KB-Eingabe-
 * Deckel VOR jedem `JSON.parse`/`JSON.stringify` (C1-Ruling: schuetzt vor teurem Parsen
 * riesiger Payloads, unabhaengig vom Ausgabelimit), (2) ein einziger `Buffer#subarray`-
 * Schnitt (O(n)) fuer die 2-KB-Ausgabegrenze. Redaktionsfehler (kein JSON, oder JSON,
 * dessen Verarbeitung wirft) fallen NIE mehr auf den Rohtext zurueck (I2) — stattdessen ein
 * Marker. Query-Parameter mit verdaechtigem Namen werden ebenfalls geschwaerzt (I1).
 */
export const MAX_BODY_BYTES = 2048;
/** Eingabe-Deckel VOR JSON.parse/Redaktion (C1/I2) — deutlich groesser als MAX_BODY_BYTES,
 *  weil legitime Bodies vor der Kuerzung durchaus einige zehn KB gross sein duerfen; schuetzt
 *  aber vor `JSON.parse`/`JSON.stringify` auf sehr grossen (MB-grossen) Payloads. */
export const MAX_INPUT_BYTES = 256 * 1024;
export const REDACTED = "[redaktiert]";
// Fix-Welle (m7): nicht mehr `export` — wird ausserhalb dieses Moduls nirgends importiert
// (weder von redactJson noch von der neuen redactQuery, beide bleiben innerhalb der Datei).
const SECRET_KEY_PATTERN = /(secret|token|password|passwort|api[_-]?key|authorization|iban|bic)/i;
/** Zusaetzlich zu SECRET_KEY_PATTERN nur fuer Query-Parameter (I1): E-Mail-Adressen sind
 *  keine Geheimnisse, aber personenbezogene Daten (z. B. `/api/v1/Contact?email=...`). */
const QUERY_ONLY_PATTERN = /email/i;
/** Marker statt Rohtext, wenn der Eingabe-Deckel greift (kein `JSON.parse` versucht). */
const TOO_LARGE_MARKER = JSON.stringify({ truncated: true, reason: "too-large" });
/** Marker statt Rohtext, wenn Parsen/Schwaerzen scheitert (I2: nie auf den Rohtext zurueckfallen). */
const UNREDACTABLE_MARKER = JSON.stringify({ redacted: false, reason: "unparseable" });

/** Pfade ohne Protokolleintrag — exakt ODER als Praefix mit "/". Fix-Welle (m7): nicht
 *  mehr `export` — nur `shouldLogPath` unten wird ausserhalb dieses Moduls gebraucht. */
const UNLOGGED_PATHS: readonly string[] = ["/api/docs", "/api/v1/openapi.json", "/api/v1/ping", "/api/v1/ApiRequestLog"];

export function shouldLogPath(pathname: string): boolean {
  return !UNLOGGED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactJson(v);
  }
  return out;
}

/**
 * Schwaerzt verdaechtige Query-Parameter (Geheimnis-Muster + E-Mail) VOR dem Speichern
 * (I1). Liefert bei einem Redaktionsfehler `null` — der Aufrufer speichert dann den Pfad
 * OHNE Query, statt einen moeglicherweise ungeschwaerzten String zu riskieren. Bleibt der
 * Query-String unveraendert (kein verdaechtiger Schluessel), wird der Originaltext
 * zurueckgegeben statt einer `URLSearchParams`-Neukodierung (vermeidet z. B. `%20`-vs-`+`-
 * Abweichungen fuer den haeufigen Fall ohne Redaktionsbedarf).
 */
export function redactQuery(search: string | null | undefined): string | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    let changed = false;
    for (const key of [...params.keys()]) {
      if (SECRET_KEY_PATTERN.test(key) || QUERY_ONLY_PATTERN.test(key)) {
        params.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? params.toString() : search;
  } catch {
    return null;
  }
}

/** EIN Buffer-Schnitt (O(n)) auf MAX_BODY_BYTES statt einer zeichenweisen Schleife (C1).
 *  Ein am Schnitt zerrissenes Mehrbyte-Zeichen dekodiert `Buffer#toString` als U+FFFD
 *  (Ersatzzeichen) -> abschneiden, damit kein kaputtes Zeichen am Ende steht. */
function truncateToMaxBytes(text: string): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= MAX_BODY_BYTES) return { text, truncated: false };
  let cut = buf.subarray(0, MAX_BODY_BYTES).toString("utf8");
  if (cut.endsWith("�")) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

/**
 * Schwaerzt (JSON-Pfad) und kuerzt auf MAX_BODY_BYTES. Nicht-JSON-Bodies UND Bodies, deren
 * Redaktion/Serialisierung wirft, werden NIE roh gespeichert (I2) — stattdessen ein Marker.
 * Bodies ueber MAX_INPUT_BYTES werden GAR NICHT geparst (C1/I2: schuetzt `JSON.parse`/
 * `JSON.stringify` vor sehr grossen Payloads, z. B. einem Anhang-Upload) — auch hier nur
 * ein Marker, ohne die teure Verarbeitung ueberhaupt zu versuchen.
 */
export function prepareBody(raw: string | null | undefined): { text: string | null; truncated: boolean } {
  if (!raw) return { text: null, truncated: false };
  if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) {
    return { text: TOO_LARGE_MARKER, truncated: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Kein JSON (z. B. form-encoded oder Klartext) -> NIE roh speichern (I2).
    return { text: UNREDACTABLE_MARKER, truncated: false };
  }
  let text: string;
  try {
    text = JSON.stringify(redactJson(parsed));
  } catch {
    // Valides JSON, aber Redaktion/Serialisierung wirft (z. B. sehr tiefe Verschachtelung
    // -> RangeError) -> ebenfalls NIE roh speichern (I2): die Redaktion waere sonst umgangen.
    return { text: UNREDACTABLE_MARKER, truncated: false };
  }
  return truncateToMaxBytes(text);
}
