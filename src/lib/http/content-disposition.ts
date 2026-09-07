/**
 * Content-Disposition-Header fuer Datei-Downloads nach RFC 6266/5987: ein ASCII-
 * Fallback (`filename="..."`) fuer Clients, die kein `filename*` verstehen, PLUS die
 * korrekte UTF-8-Variante (`filename*=UTF-8''...`) fuer alle anderen — sonst gehen
 * Umlaute/Emoji/Sonderzeichen im Dateinamen beim Download verloren oder brechen den
 * Header (W1, Fix-Welle nach Abschluss-Review).
 */

/** Ersetzt alles ausserhalb des druckbaren ASCII-Bereichs sowie Anfuehrungszeichen/Backslash/Steuerzeichen durch "_". */
function asciiFallback(filename: string): string {
  return filename.replace(/[^\x20-\x7e]|["\\]/g, "_").trim() || "download";
}

/** Percent-encodiert nach RFC 5987 (attr-char) — encodeURIComponent laesst einige Zeichen unencodiert. */
function encodeRfc5987(filename: string): string {
  return encodeURIComponent(filename).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Baut den vollstaendigen `Content-Disposition: attachment; ...`-Headerwert. */
export function contentDispositionAttachment(filename: string): string {
  const fallback = asciiFallback(filename);
  const encoded = encodeRfc5987(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
