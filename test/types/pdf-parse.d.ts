/**
 * Ambient-Typdeklaration fuer `pdf-parse` (Phase 7, Task 3) — bewusst KEIN
 * `@types/pdf-parse` als zusaetzliche Abhaengigkeit (Global Constraint im
 * plan-header.md: "Neue Abhaengigkeiten nur qrcode (prod) und pdf-parse (dev)").
 * Deckt nur das ab, was die Tests tatsaechlich nutzen (`data.text`).
 */
interface PdfParseResult {
  text: string;
  numpages: number;
  numrender: number;
  info: unknown;
  metadata: unknown;
  version: string;
}

declare module "pdf-parse" {
  function pdfParse(dataBuffer: Buffer, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}

// `pdf-parse`s eigener `index.js` liest beim Import (Modul-Top-Level) eine Test-PDF von
// der Festplatte, sobald `module.parent` fehlt (`isDebugMode`) — unter Vitest/ESM immer
// der Fall, siehe node_modules/pdf-parse/index.js. Tests importieren deshalb direkt die
// Implementierung, die diesen Debug-Zweig nicht hat.
declare module "pdf-parse/lib/pdf-parse.js" {
  function pdfParse(dataBuffer: Buffer, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
