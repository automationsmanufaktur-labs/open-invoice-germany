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
    showPaymentTermsText: true,
    compress: false,
    ...overrides,
  };
}
