/**
 * Lädt das PDF-Theme (Briefpapier + effektive Druckoptionen inkl. Logo-/Hintergrund-
 * Dateien) für eine Organisation (Phase 7, Task 3, §35-§37). Einziger Ort, der
 * `PdfTheme` mit Datei-Inhalt befüllt — Renderer selbst bleiben DB-/Dateisystem-frei.
 */
import { dbInternal } from "@/lib/db";
import { readFile } from "@/lib/attachments/storage";
import { loadBrandingSettings } from "@/domain/settings/branding";
import { loadPrintSettings, effectivePrintOptions } from "@/domain/settings/print";
import { loadDocumentSettings } from "@/domain/document/settings";
import { resolveLayoutId } from "@/domain/settings/layout";
import type { LayoutDocType } from "@/lib/pdf/layouts/ids";
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
 *
 * Phase 11b, Task 3 — `layoutId` wird ueber `resolveLayoutId` aufgeloest (Beleg-Override
 * aus `options.layoutId` > Typ-Map `brand.layoutByType[docType]` > Organisationsstandard
 * `brand.layoutId` > "standard"); `docType` faellt ohne Angabe auf "INVOICE" zurueck
 * (bestehende Aufrufer bleiben unveraendert lauffaehig). `footerFacts` kommt aus
 * `Organization.website`/`.ownerName` (Phase 11b, Task 1).
 */
export async function loadPdfTheme(orgId: string, overrideJson?: string | null, docType: LayoutDocType = "INVOICE"): Promise<PdfTheme> {
  const [brand, printSettings, documentSettings, org] = await Promise.all([
    loadBrandingSettings(orgId),
    loadPrintSettings(orgId),
    loadDocumentSettings(orgId),
    dbInternal.organization.findUnique({ where: { id: orgId }, select: { website: true, ownerName: true } }),
  ]);
  const options = effectivePrintOptions(printSettings, overrideJson);
  const layoutId = resolveLayoutId({
    overrideLayoutId: options.layoutId ?? null,
    layoutByType: brand.layoutByType,
    orgDefault: brand.layoutId,
    docType,
  });

  const [logoBuffer, backgroundBuffer] = await Promise.all([
    readOptionalFile(brand.logoPath),
    brand.showBackground ? readOptionalFile(brand.backgroundPath) : Promise.resolve(undefined),
  ]);

  return {
    brand,
    options,
    layoutId,
    footerFacts: { website: org?.website ?? null, ownerName: org?.ownerName ?? null },
    logoBuffer,
    backgroundBuffer,
    showPaymentTermsText: documentSettings.showPaymentTermsText,
  };
}
