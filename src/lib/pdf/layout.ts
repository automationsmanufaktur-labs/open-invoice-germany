/**
 * Layout-Bausteine, die von allen drei PDF-Renderern (Rechnung/Angebot, Lieferschein,
 * Mahnung) geteilt werden: mm→pt, Ränder aus dem Theme, Absenderzeile, Logo oben rechts,
 * Hintergrundbild vollflächig (Phase 7, Task 3, §35/§36). Die Fusszeile lebt seit Phase
 * 11b in `footer.ts` (Spalten-Fakten) + `layouts/shared.ts#drawFooterColumns` (Zeichnen).
 */
import type { PdfTheme } from "./theme";

export { mm, MM_TO_PT } from "./marks";
import { mm } from "./marks";

export interface PdfMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Ränder aus dem Theme (BrandingSettings, in mm) — bereits in PDF-Punkt (pt). */
export function pdfMargins(theme: PdfTheme): PdfMargins {
  return {
    top: mm(theme.brand.marginTopMm),
    right: mm(theme.brand.marginRightMm),
    bottom: mm(theme.brand.marginBottomMm),
    left: mm(theme.brand.marginLeftMm),
  };
}

/**
 * Zeichnet, sofern `brand.showBackground` an ist und ein Hintergrundbild geladen wurde,
 * dieses vollflächig (0,0 bis Seitenrand) — MUSS vor jedem übrigen Seiteninhalt gezeichnet
 * werden (pdfkit-`pageAdded`-Event, vor dem eigentlichen Rendern der ersten Seite manuell
 * aufrufen, da `pageAdded` beim Erzeugen des Dokuments für Seite 1 nicht feuert).
 */
export function drawBackground(doc: PDFKit.PDFDocument, theme: PdfTheme): void {
  if (!theme.brand.showBackground || !theme.backgroundBuffer) return;
  doc.image(theme.backgroundBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
}

/** Maximale Logo-Hoehe in mm (Phase 12a). `drawLogo` zeichnete bisher nur mit `{ width }`
 *  — ein hohes, schmales Logo wuchs unbegrenzt nach unten und lief in den Adressblock.
 *  `fit` skaliert proportional in die Box [Breite x LOGO_MAX_HEIGHT_MM]; breite/flache
 *  Logos (der Normalfall) rendern unveraendert. */
export const LOGO_MAX_HEIGHT_MM = 35;

/** Zeichnet das Logo oben rechts (Breite `brand.logoWidthMm`); ohne Logo-Buffer no-op. */
export function drawLogo(doc: PDFKit.PDFDocument, theme: PdfTheme, right: number, top: number): void {
  if (!theme.logoBuffer) return;
  const width = mm(theme.brand.logoWidthMm);
  doc.image(theme.logoBuffer, right - width, top, { fit: [width, mm(LOGO_MAX_HEIGHT_MM)], align: "right" });
}

/**
 * Absenderzeile (kleine Zeile über der Empfängeradresse, DIN-5008-Sichtfenster) — nutzt
 * `brand.senderLine`, wenn gesetzt, sonst den übergebenen Fallback-Text (bisherige
 * hartcodierte Absenderzeile). Zeichnet nichts, wenn `options.showSenderLine` aus ist.
 */
export function drawSenderLine(doc: PDFKit.PDFDocument, theme: PdfTheme, left: number, y: number, fallback: string): void {
  if (!theme.options.showSenderLine) return;
  const text = theme.brand.senderLine || fallback;
  doc.fontSize(9).fillColor("#555555").text(text, left, y);
}
