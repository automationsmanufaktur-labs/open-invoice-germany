/**
 * Liest Breite/Hoehe aus dem IHDR-Chunk eines PNG (Phase 12c). Bewusst KEINE
 * Bildbibliothek: fuer die eine Favicon-Regel ("quadratisch, 32..512 px") genuegen die
 * acht Bytes ab Offset 16 der festen PNG-Struktur (8 Byte Signatur + 4 Byte Laenge +
 * 4 Byte "IHDR" + 4 Byte Breite + 4 Byte Hoehe).
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
