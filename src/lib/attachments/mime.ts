/**
 * MIME-/Magic-Bytes-Pruefung fuer Beleganhaenge (Phase 4b, Lastenheft §38).
 *
 * Zwei unabhaengige Pruefungen muessen beide bestehen, bevor eine Datei gespeichert wird:
 *  1. Der vom Client behauptete MIME-Typ steht in der Whitelist (Zod, attachmentUploadSchema
 *     in src/schemas/index.ts) — verhindert ausfuehrbare Formate ueber den deklarierten Typ.
 *  2. `sniffMime` erkennt den TATSAECHLICHEN Typ anhand der ersten Bytes und muss mit dem
 *     behaupteten Typ uebereinstimmen — verhindert eine umbenannte .exe mit ".pdf"-Endung
 *     UND eine echte PDF, die mit einer nicht erlaubten Endung (z. B. ".exe") hochgeladen wird
 *     (Endungspruefung siehe `extensionMatchesMime`).
 *
 * Diese Konstanten werden auch von der Zusatzanhang-Route fuer den Mailversand
 * (src/app/api/emails/send/route.ts) genutzt — dort NICHT erneut pflegen (Auftrag Task 3).
 */

/** Groesse je Anhang (Lastenheft §38). Gilt fuer Beleganhaenge UND Mail-Zusatzanhaenge. */
export const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;
/** Summe je Beleg (Beleganhaenge, src/domain/attachment/manage.ts). */
export const MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC = 50 * 1024 * 1024;
/** Summe der Zusatzanhaenge EINER Mail (fruehe Grenze der Send-Route, VOR dem Zusammenbau
 *  mit Standard-/Beleganhaengen — siehe MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES fuer die
 *  massgebliche Gesamtgrenze). */
export const MAX_EMAIL_EXTRA_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;
/** G3 (Fix-Welle): Gesamtgroesse ALLER Anhaenge EINER Mail — Standard- (PDF/XML) +
 *  Zusatz- + Beleganhaenge zusammen. Die Route prueft oben nur die Zusatzanhaenge frueh
 *  (vor DB-/Netzzugriff); massgeblich ist die Pruefung in sendDocumentEmail, NACHDEM
 *  Standard- und Beleganhaenge geladen wurden. */
export const MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

/** Datei-Endung (ohne Punkt, kleingeschrieben) je erlaubtem MIME-Typ — verhindert eine
 *  echte PDF unter ".exe" ebenso wie eine .exe unter ".pdf" (Whitelist zusaetzlich zu
 *  Magic-Bytes, doppelte Verteidigungslinie). */
export const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/msword": ["doc"],
  "application/vnd.ms-excel": ["xls"],
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** Prueft, ob die Dateiendung zum (behaupteten) MIME-Typ passt. */
export function extensionMatchesMime(filename: string, mime: string): boolean {
  const allowed = MIME_EXTENSIONS[mime];
  if (!allowed) return false;
  return allowed.includes(extensionOf(filename));
}

const PDF_MAGIC = Buffer.from("%PDF");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_MAGIC = Buffer.from("GIF87a");
const GIF89_MAGIC = Buffer.from("GIF89a");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
const ZIP_EMPTY_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // leeres ZIP-Archiv
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // altes .doc/.xls

function startsWith(buf: Buffer, magic: Buffer): boolean {
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

/** RIFF....WEBP */
function isWebp(buf: Buffer): boolean {
  return buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
}

/** ZIP-Container (DOCX/XLSX sind OOXML-ZIPs) — enthaelt zwingend `[Content_Types].xml`
 *  als lokalen Dateieintrag im Zentralverzeichnis oder direkt am Anfang des Archivs.
 *  Reicht als Heuristik, ohne das ZIP komplett zu parsen (kein Unzip-Dependency). */
function isOoxmlZip(buf: Buffer): boolean {
  if (!startsWith(buf, ZIP_MAGIC) && !startsWith(buf, ZIP_EMPTY_MAGIC)) return false;
  return buf.includes(Buffer.from("[Content_Types].xml"));
}

/** Text-Heuristik fuer TXT/CSV: gueltiges UTF-8, kein NUL-Byte (typisch fuer Binaerdateien,
 *  die als Textformat getarnt hochgeladen werden). */
function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0x00)) return false;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return !decoded.includes("�");
  } catch {
    return false;
  }
}

/**
 * Erkennt den TATSAECHLICHEN Dateityp anhand der ersten Bytes (Magic-Bytes). Liefert
 * einen der Whitelist-MIME-Typen (ATTACHMENT_MIME_WHITELIST) oder `null`, wenn der
 * Inhalt zu keinem bekannten Muster passt.
 *
 * DOCX/XLSX teilen sich denselben ZIP-Container — hier wird nur "ist es ein gueltiger
 * OOXML-ZIP" erkannt, NICHT zwischen DOCX und XLSX unterschieden (das steht im
 * behaupteten MIME-Typ, den der Aufrufer separat gegen die Endung prueft). Alte
 * Binaerformate (.doc/.xls) sind OLE2-Container mit eigener Signatur.
 */
export function sniffMime(buf: Buffer): string | null {
  if (startsWith(buf, PDF_MAGIC)) return "application/pdf";
  if (startsWith(buf, PNG_MAGIC)) return "image/png";
  if (startsWith(buf, JPG_MAGIC)) return "image/jpeg";
  if (startsWith(buf, GIF87_MAGIC) || startsWith(buf, GIF89_MAGIC)) return "image/gif";
  if (isWebp(buf)) return "image/webp";
  if (startsWith(buf, OLE2_MAGIC)) return "ole2"; // Sonderwert: .doc/.xls, Aufrufer prueft gegen behaupteten Typ
  if (startsWith(buf, ZIP_MAGIC) || startsWith(buf, ZIP_EMPTY_MAGIC)) {
    // Jedes ZIP-Archiv (auch eines OHNE [Content_Types].xml) ist ein Binaerformat — NIE
    // als Text durchfallen lassen, sonst wuerde ein manipuliertes/fremdes ZIP als TXT/CSV
    // akzeptiert (die ZIP-Kennung besteht zufaellig aus gueltigen UTF-8-Bytes).
    return isOoxmlZip(buf) ? "ooxml-zip" : null;
  }
  if (looksLikeText(buf)) return "text"; // Sonderwert: TXT/CSV, Aufrufer prueft gegen behaupteten Typ
  return null;
}

/**
 * Prueft Inhalt (Magic-Bytes) UND Dateiendung gegen den behaupteten MIME-Typ. Wirft
 * KEINEN Fehler — liefert stattdessen ein Ergebnis, das der Aufrufer (storeFile) in einen
 * sprechenden Fehler uebersetzt.
 */
export function validateFileContent(buf: Buffer, filename: string, claimedMime: string): { ok: true } | { ok: false; reason: string } {
  if (!extensionMatchesMime(filename, claimedMime)) {
    return { ok: false, reason: `Dateiendung passt nicht zum Typ "${claimedMime}".` };
  }
  const sniffed = sniffMime(buf);
  if (sniffed === null) {
    return { ok: false, reason: "Dateiinhalt entspricht keinem erlaubten Format (Magic-Bytes)." };
  }
  const isOoxmlClaim =
    claimedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    claimedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (sniffed === "ooxml-zip") {
    return isOoxmlClaim ? { ok: true } : { ok: false, reason: "Dateiinhalt ist ein ZIP-Container, aber der behauptete Typ ist kein DOCX/XLSX." };
  }
  const isOle2Claim = claimedMime === "application/msword" || claimedMime === "application/vnd.ms-excel";
  if (sniffed === "ole2") {
    return isOle2Claim ? { ok: true } : { ok: false, reason: "Dateiinhalt ist ein OLE2-Container, aber der behauptete Typ ist kein DOC/XLS." };
  }
  const isTextClaim = claimedMime === "text/plain" || claimedMime === "text/csv";
  if (sniffed === "text") {
    return isTextClaim ? { ok: true } : { ok: false, reason: "Dateiinhalt ist Klartext, aber der behauptete Typ erwartet Binaerdaten." };
  }
  return sniffed === claimedMime ? { ok: true } : { ok: false, reason: `Dateiinhalt (${sniffed}) passt nicht zum behaupteten Typ "${claimedMime}".` };
}
