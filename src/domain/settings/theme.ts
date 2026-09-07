/**
 * Lädt das PDF-Theme (Briefpapier + effektive Druckoptionen inkl. Logo-/Hintergrund-
 * Dateien) für eine Organisation (Phase 7, Task 3, §35-§37). Einziger Ort, der
 * `PdfTheme` mit Datei-Inhalt befüllt — Renderer selbst bleiben DB-/Dateisystem-frei.
 */
import { readFile } from "@/lib/attachments/storage";
import { loadBrandingSettings } from "@/domain/settings/branding";
import { loadPrintSettings, effectivePrintOptions } from "@/domain/settings/print";
import { loadDocumentSettings } from "@/domain/document/settings";
import type { PdfTheme } from "@/lib/pdf/theme";

/** Liest eine gespeicherte Logo-/Hintergrunddatei; fehlt sie (gelöscht/inkonsistent),
 *  wird OHNE sie gerendert statt zu werfen (Task-3-Facts). */
async function readOptionalFile(storagePath: string | null): Promise<Buffer | undefined> {
  if (!storagePath) return undefined;
  try {
    return await readFile(storagePath);
  } catch {
    return undefined;
  }
}

/**
 * Lädt Branding + effektive Druckoptionen (global verschmolzen mit einer optionalen
 * Beleg-individuellen Überschreibung, `overrideJson` = `Invoice/Quote/DeliveryNote.
 * printOptionsJson`), die Logo-/Hintergrundbild-Buffer sowie `showPaymentTermsText`
 * (Fix-Runde 1: aus `DocumentSettings`, nicht Teil von PrintSettings/BrandingSettings).
 * `compress` wird hier bewusst NICHT gesetzt — der Renderer-Default ist `true`
 * (Produktionspfad), `false` ist ausschließlich Tests vorbehalten.
 */
export async function loadPdfTheme(orgId: string, overrideJson?: string | null): Promise<PdfTheme> {
  const [brand, printSettings, documentSettings] = await Promise.all([
    loadBrandingSettings(orgId),
    loadPrintSettings(orgId),
    loadDocumentSettings(orgId),
  ]);
  const options = effectivePrintOptions(printSettings, overrideJson);

  const [logoBuffer, backgroundBuffer] = await Promise.all([
    readOptionalFile(brand.logoPath),
    brand.showBackground ? readOptionalFile(brand.backgroundPath) : Promise.resolve(undefined),
  ]);

  return { brand, options, logoBuffer, backgroundBuffer, showPaymentTermsText: documentSettings.showPaymentTermsText };
}
