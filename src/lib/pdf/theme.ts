/**
 * PDF-Theme: Briefpapier (BrandingSettings) + effektive Druckoptionen, optional geladene
 * Logo-/Hintergrundbild-Buffer. Reiner Typ — das Laden (inkl. Dateizugriff) übernimmt
 * `src/domain/settings/theme.ts` (`loadPdfTheme`), damit dieses Modul framework-/DB-frei
 * bleibt und in den Renderern ohne Zyklen importiert werden kann.
 */
import type { BrandingSettingsInput, PrintSettingsInput } from "@/schemas/settings";

/** Die effektiven (Global + Beleg-Override verschmolzenen) Druckoptionen, siehe
 *  `effectivePrintOptions` in `src/domain/settings/print.ts`. */
export type EffectivePrintOptions = PrintSettingsInput;

export interface PdfTheme {
  brand: BrandingSettingsInput;
  options: EffectivePrintOptions;
  /** Logo-Bilddaten, wenn `brand.logoPath` gesetzt ist UND die Datei lesbar war. */
  logoBuffer?: Buffer;
  /** Hintergrundbild-Daten, wenn `brand.showBackground` an ist UND die Datei lesbar war. */
  backgroundBuffer?: Buffer;
  /** Phase 7, Task 1 (§33) — DocumentSettings.showPaymentTermsText: Zahlungsziel-/
   *  Skonto-Text ("Zahlbar bis ..."/paymentTermsHuman) im PDF nur wenn an. Von
   *  `loadPdfTheme` aus DocumentSettings geladen (nicht Teil von PrintSettings/
   *  BrandingSettings, daher ein eigenes Top-Level-Feld statt unter `options`). */
  showPaymentTermsText: boolean;
  /**
   * Fix-Runde 1 (Koordinator): Content-Stream-Kompression (`PDFDocument({compress})`).
   * Produktionspfad MUSS komprimieren (Default `true`, wenn `undefined`) — `false` ist
   * NUR fuer Tests gedacht, die den PDF-Text mit `pdf-parse` (Version 1.1.1, buendelt
   * eine sehr alte pdf.js-Version) extrahieren: diese wirft bei EINIGEN strukturell
   * validen, komprimierten pdfkit-PDFs `bad XRef entry` (verifiziert mit `qpdf --check`/
   * `pdftotext`: dieselben Dateien sind gueltig). `testPdfTheme()`
   * (test/helpers/pdf-theme.ts) setzt deshalb `false`; echte Aufrufer (`loadPdfTheme`)
   * setzen dieses Feld NICHT — Produktions-PDFs sind immer komprimiert.
   */
  compress?: boolean;
}
