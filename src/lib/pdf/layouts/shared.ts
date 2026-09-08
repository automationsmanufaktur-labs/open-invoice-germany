/**
 * Layout-Bausteine (Phase 11b), die mehrere PdfLayouts teilen: Empfaengerblock,
 * rechtsbuendige/-zweispaltige Meta-Zeilen, Tabellenkopfzeile, Fusszeilen-Spalten,
 * Logo+Absenderzeile. Reine Zeichenfunktionen auf einem `LayoutFrame` — kein
 * Layout-spezifisches Wissen (das liefert `layout.table`/`layout.footerHeight`).
 */
import type { LayoutFrame, KopfInput, FooterColumn, PdfLayout } from "./types";
import { drawLogo, drawSenderLine } from "../layout";

/**
 * Empfaengerblock (DIN-5008-Fenster); liefert Unterkante.
 *
 * Follow-up (Reviews, Task 5): bisher ohne `width` — ein langer Empfaengername lief in
 * den rechten Infoblock (Meta-Zeilen/-Tabelle) hinein, weil pdfkit ohne `width` bis zum
 * Seitenrand umbricht. `maxWidth` begrenzt jede Zeile des Blocks auf die linke Spalte.
 *
 * Fix-Runde 1 (Task-5-Review): der urspruengliche Default `frame.width - 220` war
 * margin-abhaengig, obwohl `standard`/`klassik` (und via Delegation blau/schwarz/kompakt)
 * ihren Infoblock an einem FESTEN `left + 250` verankern — bei den Standard-18mm-Raendern
 * ergab das ~273pt (23pt zu weit, ueberlappt bereits leicht die Meta-Spalte), bei den
 * schema-erlaubten 5mm-Raendern sogar ~347pt. Der Default ist jetzt der feste Wert `240`
 * (= 250 − 10pt Abstand), unabhaengig von `frame.width`/den Raendern; `standard` und
 * `klassik` reichen ihn zusaetzlich explizit durch (statt sich auf den Default zu
 * verlassen), analog zu `schlicht`/`modern`, die ihre eigene (schmalere, weiter links
 * beginnende) Infoblock-Breite durchreichen (Infoblock-x minus 10pt Abstand minus `left`).
 */
export function drawRecipient(frame: LayoutFrame, input: KopfInput, y: number, size = 11, maxWidth = 240): number {
  const { doc, left } = frame;
  const r = input.recipient;
  doc.fillColor("#000").font("Helvetica").fontSize(size);
  doc.text(r.name, left, y, { width: maxWidth });
  if (r.contactName) doc.text(r.contactName, { width: maxWidth });
  doc.text(r.addressLine1, { width: maxWidth });
  if (r.addressLine2) doc.text(r.addressLine2, { width: maxWidth });
  doc.text(`${r.postalCode} ${r.city}`, { width: maxWidth });
  if (input.extraRecipientBlock) {
    doc.fontSize(size - 2).fillColor("#555").text(input.extraRecipientBlock.heading, left, doc.y + 8, { width: maxWidth });
    doc.fontSize(size).fillColor("#000");
    for (const l of input.extraRecipientBlock.lines) doc.text(l, { width: maxWidth });
  }
  return doc.y;
}

/** Rechtsbuendige Meta-Zeilen "Label: Wert" ab (x, y); liefert Unterkante. */
export function drawMetaRows(frame: LayoutFrame, rows: { label: string; value: string }[], x: number, y: number, size = 10, color = "#333"): number {
  const { doc, right } = frame;
  doc.font("Helvetica").fontSize(size).fillColor(color);
  let first = true;
  for (const row of rows) {
    if (first) {
      doc.text(`${row.label}: ${row.value}`, x, y, { width: right - x, align: "right" });
      first = false;
    } else {
      doc.text(`${row.label}: ${row.value}`, { width: right - x, align: "right" });
    }
  }
  return doc.y;
}

/**
 * Zweispaltige Meta-Tabelle (Label links grau, Wert rechts) fuer Infobloecke im Stil moderner Belege;
 * liefert Unterkante.
 *
 * Fix-Runde 1 (Koordinator, Punkt 5 — derselbe Befund wie in `standard.ts` fuer die grosse
 * Beleg-Nummer, siehe Task 4): `lineBreak: false` wird vom gebuendelten pdfkit ignoriert,
 * sobald `width` gesetzt ist (der Zeilenumbruch-Wrapper laeuft trotzdem) — ein langes Label
 * oder ein langer Wert (z. B. `Bezug: zu Auftragsbestaetigung AB-2026-00001-...`) wuerde in
 * der engen Haelftenspalte umbrechen und mit der naechsten Zeile kollidieren. `height` +
 * `ellipsis: true` erzwingt stattdessen genau eine Zeile mit "…" am Ende.
 */
export function drawMetaTable(frame: LayoutFrame, rows: { label: string; value: string }[], x: number, y: number, width: number, size = 9): number {
  const { doc } = frame;
  let cy = y;
  const lineHeight = size + 3;
  for (const row of rows) {
    doc.font("Helvetica").fontSize(size).fillColor("#555").text(row.label, x, cy, { width: width / 2, height: lineHeight, ellipsis: true });
    doc.fillColor("#000").text(row.value, x + width / 2, cy, { width: width / 2, align: "right", height: lineHeight, ellipsis: true });
    cy += size + 4;
  }
  return cy;
}

export interface TableHeaderColumn {
  header: string;
  /** Absolute x-Position (bereits inkl. `tableX`-Offset des Aufrufers). */
  x: number;
  width: number;
  align?: "left" | "right";
  /** Beschreibungsspalte: Text entfaellt ohne `showDescription`, die Spaltenbreite bleibt
   *  trotzdem reserviert (Phase 7 — Rechnungs-Tabelle rueckt sonst zusammen). */
  isDescription?: boolean;
}

/**
 * Zeichnet die Tabellenkopfzeile nach `layout.table` (dunkler Balken bei `headerFill`,
 * sonst eine Linie) und liefert die y-Koordinate, an der die erste Datenzeile beginnt.
 * Von `invoice-pdf.ts` und `delivery-note-pdf.ts` gemeinsam genutzt (Phase 11b, Task 3
 * — vorher zwei fast identische Kopien).
 */
export function drawTableHeaderRow(frame: LayoutFrame, layout: PdfLayout, columns: TableHeaderColumn[], atY: number, showDescription: boolean): number {
  const { doc, left, right, base } = frame;
  const t = layout.table;
  doc.fontSize(base - 1);
  if (t.headerFill) {
    doc.rect(left, atY, right - left, t.headerHeight).fill(t.headerFill);
  } else {
    doc.moveTo(left, atY + t.headerHeight).lineTo(right, atY + t.headerHeight).strokeColor(t.rowRule ?? "#999").stroke();
  }
  doc.fillColor(t.headerText).font(t.headerFill ? "Helvetica" : "Helvetica-Oblique");
  for (const col of columns) {
    if (col.isDescription && !showDescription) continue;
    doc.text(col.header, col.x, atY + (t.headerFill ? 5 : 3), { width: col.width, align: col.align ?? "left" });
  }
  doc.font("Helvetica").fillColor(t.textColor).fontSize(base - 1);
  return atY + t.headerHeight + 4;
}

// Follow-up (Reviews, Task 5): die gruppierte IBAN ("IBAN DE02 1203 ...", siehe
// footer.ts#groupIban) kann in der schmalen vierspaltigen AUTO-Fusszeile innerhalb
// ihrer Spalte umbrechen — die Gruppierungs-Leerzeichen machen die Zeile breiter als
// noetig. Alternative waere eine fixe 7pt-Fusszeilenschrift gewesen; bei den Standard-
// Raendern bleiben davon aber nur ~0,2pt Reserve, und je nach Randkonfiguration/IBAN-
// Laenge waere das nicht zuverlaessig. `doc.widthOfString` misst stattdessen
// deterministisch bei der gerade gesetzten Schriftgroesse — passt die gruppierte Zeile
// nicht in `maxWidth`, wird sie ungruppiert (nur die Leerzeichen der Ziffernfolge
// entfernt, das Label "IBAN " bleibt durch ein Leerzeichen getrennt) gezeichnet, damit
// sie garantiert einzeilig bleibt.
const IBAN_FOOTER_LINE = /^(IBAN )([A-Z0-9 ]+)$/;

function fitFooterLine(doc: PDFKit.PDFDocument, line: string, maxWidth: number): string {
  const m = IBAN_FOOTER_LINE.exec(line);
  if (!m || doc.widthOfString(line) <= maxWidth) return line;
  return m[1] + m[2]!.replace(/\s+/g, "");
}

/** Fusszeilen-Spalten gleichmaessig ueber die Breite; liefert nichts. */
export function drawFooterColumns(frame: LayoutFrame, columns: FooterColumn[], y: number, size = 7.5, color = "#666666"): void {
  const { doc, left, width } = frame;
  const visible = columns.filter((c) => c.lines.length > 0);
  if (visible.length === 0) return;
  const gap = 10;
  const colWidth = (width - gap * (visible.length - 1)) / visible.length;
  doc.font("Helvetica").fontSize(size).fillColor(color);
  visible.forEach((col, i) => {
    const lines = col.lines.map((line) => fitFooterLine(doc, line, colWidth));
    doc.text(lines.join("\n"), left + i * (colWidth + gap), y, { width: colWidth, lineGap: 1 });
  });
}

export function drawLogoAndSender(frame: LayoutFrame, input: KopfInput): void {
  const { doc, theme, right, left, margins } = frame;
  drawLogo(doc, theme, right, margins.top);
  drawSenderLine(doc, theme, left, margins.top, input.senderFallback);
}
