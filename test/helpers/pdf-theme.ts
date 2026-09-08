/**
 * Test-Hilfe (Phase 7, Task 3): ein `PdfTheme` mit reinen Defaults (Briefpapier +
 * Druckoptionen), ohne Logo/Hintergrund-Datei — für PDF-Renderer-Tests, die kein
 * eigenes Theme brauchen. `structuredClone`, damit kein Test versehentlich die
 * gemeinsame Default-Instanz mutiert.
 *
 * Fix-Runde 1 (Koordinator): `compress: false` (NUR hier / an expliziten Test-Call-
 * Sites, NIE im Produktionspfad — dort ist der Default `true`, siehe PdfTheme.compress)
 * — sonst wirft `pdf-parse` (buendelt eine sehr alte pdf.js-Version) bei manchen
 * strukturell validen, komprimierten pdfkit-PDFs `bad XRef entry`.
 */
import { deflateSync } from "node:zlib";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { DEFAULT_BRANDING_SETTINGS } from "@/domain/settings/branding";
import { DEFAULT_PRINT_SETTINGS } from "@/domain/settings/print";
import type { PdfTheme } from "@/lib/pdf/theme";

/**
 * Fix-Welle (Final-Review): `pdf-parse` (buendelt pdfjs v1.10.100, ~2017) hat einen
 * "Fake Worker"-Bug, der beim ZWEITEN/dritten `pdfParse()`-Aufruf im selben Prozess
 * gelegentlich "bad XRef entry" wirft — auch fuer strukturell einwandfreie PDFs (mit
 * `qpdf --check` verifiziert). Ein einzelner erneuter Versuch mit einer FRISCHEN
 * Buffer-Kopie behebt es zuverlaessig (der erste, isolierte Aufruf im Prozess wirft nie).
 * Kein Produktionscode-Workaround noetig — reines Testwerkzeug-Problem.
 */
export async function parsePdf(pdf: Buffer): Promise<{ numpages: number; text: string }> {
  try {
    return await pdfParse(pdf);
  } catch {
    return await pdfParse(Buffer.from(pdf));
  }
}

export function testPdfTheme(overrides: Partial<PdfTheme> = {}): PdfTheme {
  return {
    brand: structuredClone(DEFAULT_BRANDING_SETTINGS),
    options: structuredClone(DEFAULT_PRINT_SETTINGS),
    layoutId: "standard",
    footerFacts: {},
    showPaymentTermsText: true,
    compress: false,
    ...overrides,
  };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Einfarbig graues RGB-PNG (Farbtyp 2, 8 bit) — Test-Logo fuer PDF-Renderer-Tests.
 *  Selbst erzeugt statt als Fixture committet: das Projekt hat keine Binaerdateien.
 *  pdfkit (png.js) liest Farbtyp 2 direkt. */
export function testPngBuffer(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // Farbtyp 2 = Truecolour (RGB)
  const stride = 1 + width * 3; // je Zeile ein Filter-Byte 0 ("None")
  const raw = Buffer.alloc(height * stride, 0x80);
  for (let y = 0; y < height; y++) raw[y * stride] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
