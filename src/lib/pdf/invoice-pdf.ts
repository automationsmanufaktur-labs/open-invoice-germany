/**
 * Erzeugt ein PDF einer Rechnung ("sonstige Rechnung" i.S.d. § 14 UStG).
 * Layout enthält alle Pflichtangaben; für B2B-E-Rechnungen ist zusätzlich der
 * XRechnung-/ZUGFeRD-Export maßgeblich (XML ist führend).
 *
 * Phase 7, Task 3 (§35-§37): Briefpapier (Logo/Farbe/Ränder/Fusszeilen), Druckoptionen
 * (Spalten/Marken/Seitenzahlen/GiroCode) kommen aus einem `PdfTheme` (siehe
 * `src/domain/settings/theme.ts#loadPdfTheme`) statt aus Konstanten.
 *
 * Phase 11b (PDF-Layouts): Kopf/Tabellenstil/Summenlinie/Fusszeile kommen jetzt aus einem
 * `PdfLayout` (`layouts/registry.ts#getLayout`, aufgeloest über `theme.layoutId`) statt aus
 * fest verdrahteter Zeichenlogik — `standard` ist die byte-fuer-byte-aequivalente Extraktion
 * des bisherigen (Phase-7-)Layouts.
 */
import PDFDocument from "pdfkit";
import { formatCents, formatQuantity } from "@/lib/money";
import { parseRichText, renderRichTextPdf } from "@/lib/richtext";
import { computeSubtotals } from "@/domain/document/lines";
import type { EInvoiceData, EInvoiceLine } from "@/lib/einvoice/types";
import type { PdfTheme } from "./theme";
import { mm, drawFoldMarks, drawPunchMark, drawPageNumbers, drawWatermark, concatPdfChunks } from "./marks";
import { pdfMargins, drawBackground } from "./layout";
import { buildEpcPayload, EpcError } from "./epc";
import { renderGiroCode } from "./giro";
import { CONSUMER_RETENTION_HINT } from "@/domain/invoice/mandatory";
import { getLayout } from "./layouts/registry";
import { drawTableHeaderRow } from "./layouts/shared";
import type { LayoutFrame, KopfMetaRow, PdfLayout } from "./layouts/types";
import { buildFooterColumns } from "./footer";

function lineType(line: EInvoiceLine): "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL" {
  return line.lineType ?? "ITEM";
}

const TYPE_TITLE: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Stornorechnung",
  // M4 (Fix-Welle Final-Review): "Rechnungskorrektur" statt "Korrekturrechnung" — dasselbe
  // Wort wie documentTitle() unten fuer creditNoteKind === "KORREKTUR" verwendet.
  CORRECTION: "Rechnungskorrektur",
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma-Rechnung",
  // Phase 5 (§13-15 UStG)
  PARTIAL: "Teilrechnung",
  DOWNPAYMENT: "Abschlagsrechnung",
  FINAL: "Schlussrechnung",
};

const NUMBER_LABEL: Record<string, string> = {
  INVOICE: "Rechnungsnummer",
  CREDIT_NOTE: "Gutschriftnummer",
  CORRECTION: "Korrekturnummer",
  ANGEBOT: "Angebotsnummer",
  AUFTRAGSBESTAETIGUNG: "Auftragsnummer",
  PROFORMA: "Proforma-Nr.",
  // Phase 5
  PARTIAL: "Rechnungsnummer",
  DOWNPAYMENT: "Rechnungsnummer",
  FINAL: "Rechnungsnummer",
};

// Phase 5 (§13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG) — Hinweis auf Abschlagsrechnungen:
// die Steuer entsteht mit Vereinnahmung des Entgelts, nicht mit Leistungserbringung.
const DOWNPAYMENT_TAX_HINT =
  "Anzahlung, Steuer wird mit Vereinnahmung geschuldet (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG).";

/**
 * Phase 12b (COMPLIANCE.md § 11): "Gutschrift" ist umsatzsteuerlich die Selbstabrechnung
 * (§ 14 Abs. 2 S. 5 UStG, TypeCode 389) — diese Software erzeugt aber Storno bzw.
 * Korrektur. Der Titel benennt das korrekt; InvoiceTypeCode bleibt 381, der
 * Nummernkreis CREDIT_NOTE bleibt unveraendert. Ohne aufloesbares Original faellt der
 * Titel auf "Stornorechnung" zurueck (der weit haeufigere Fall).
 */
function documentTitle(data: EInvoiceData): string {
  if (data.type === "CREDIT_NOTE") return data.creditNoteKind === "KORREKTUR" ? "Rechnungskorrektur" : "Stornorechnung";
  return TYPE_TITLE[data.type] ?? "Beleg";
}
function documentNumberLabel(data: EInvoiceData): string {
  if (data.type === "CREDIT_NOTE") return data.creditNoteKind === "KORREKTUR" ? "Korrekturnummer" : "Stornonummer";
  return NUMBER_LABEL[data.type] ?? "Belegnummer";
}

// Phase 7 (§37) — GiroCode nur für die Rechnungs-Familie, nie für Gutschrift oder
// Geschäftsdokumente (Angebot/AB/Proforma erzeugen ohnehin kein giroAmountCents).
const GIRO_ELIGIBLE_TYPES = new Set(["INVOICE", "PARTIAL", "DOWNPAYMENT", "FINAL", "CORRECTION"]);

function deDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

interface ItemColumn {
  key: "pos" | "artNr" | "desc" | "menge" | "einzel" | "ust" | "netto";
  header: string;
  width: number;
  align?: "left" | "right";
}

/** Baut die Spalten der Positions-Tabelle je nach Druckoptionen (§36) — Artikelnummer
 *  nur, wenn sowohl die Option an ist als auch mindestens eine Zeile eine Nummer trägt;
 *  USt-Satz-/Netto-Spalte je nach `showTaxRatePerLine`/`showLineTotals`. Überschüssiger
 *  Platz geht an die Beschreibung. */
function buildItemColumns(
  data: EInvoiceData,
  options: PdfTheme["options"],
  contentWidth: number,
  labels: PdfLayout["labels"],
): { columns: ItemColumn[]; x: Partial<Record<ItemColumn["key"], number>> } {
  const showArticleNumber = options.showArticleNumber && data.lines.some((l) => lineType(l) === "ITEM" && l.articleNumber);
  const showTax = options.showTaxRatePerLine;
  const showNetto = options.showLineTotals;

  const columns: ItemColumn[] = [{ key: "pos", header: "Pos.", width: 28 }];
  if (showArticleNumber) columns.push({ key: "artNr", header: "Art.-Nr.", width: 55 });
  columns.push({ key: "desc", header: "Beschreibung", width: 0 }); // Breite unten aufgefüllt
  columns.push({ key: "menge", header: "Menge", width: 50, align: "right" });
  // Fix-Welle (Abschluss-Review, Block 3 — `schlicht` vs. Referenzbeleg): Spaltenkoepfe
  // "Einzel"/"Netto" sind jetzt ueber `layout.labels` ueberschreibbar (`schlicht` nutzt
  // "Einzelpreis"/"Gesamtpreis", siehe schlicht.ts).
  columns.push({ key: "einzel", header: labels?.colEinzel ?? "Einzel", width: 70, align: "right" });
  if (showTax) columns.push({ key: "ust", header: "USt", width: 35, align: "right" });
  if (showNetto) columns.push({ key: "netto", header: labels?.colNetto ?? "Netto", width: 70, align: "right" });

  const GAP = 8;
  const fixedSum = columns.reduce((sum, c) => sum + (c.key === "desc" ? 0 : c.width), 0);
  const totalGaps = (columns.length - 1) * GAP;
  const descCol = columns.find((c) => c.key === "desc")!;
  descCol.width = Math.max(contentWidth - fixedSum - totalGaps, 60);

  const x: Partial<Record<ItemColumn["key"], number>> = {};
  let cursor = 0;
  for (const c of columns) {
    x[c.key] = cursor;
    cursor += c.width + GAP;
  }
  return { columns, x };
}

export async function renderInvoicePdf(data: EInvoiceData, theme: PdfTheme): Promise<Buffer> {
  const margins = pdfMargins(theme);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left },
    bufferPages: true,
    compress: theme.compress ?? true,
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(concatPdfChunks(chunks)));
    doc.on("error", reject);
  });
  // Hintergrundbild zuerst — `pageAdded` feuert nicht für die erste (automatisch von
  // pdfkit angelegte) Seite, daher hier zusätzlich einmal manuell. Der `pageAdded`-
  // Handler selbst wird weiter unten registriert (siehe `chromeStartY`), sobald `frame`/
  // `layout` feststehen.
  drawBackground(doc, theme);

  const cur = data.currency;
  const left = margins.left;
  const right = doc.page.width - margins.right;

  // S2 (Fix-Welle, Final-Review): der Summenblock (SUBTOTAL-Zeilen + sumRow) wird jetzt
  // aus `right` abgeleitet statt aus `left + 300`/`left + 425` — bei den schema-erlaubten
  // Randextremen (marginLeft 5mm, marginRight 40mm) wanderten die Betraege vorher bis zu
  // 27pt aus dem Inhaltsbereich heraus. Layout bleibt identisch zum Standard-18mm-Rand,
  // nur der Ankerpunkt ist jetzt der rechte statt der linke Rand.
  const sumValueWidth = 70;
  const sumLabelWidth = 120;
  const sumColGap = 5;
  const sumValueX = right - sumValueWidth;
  const sumLabelX = sumValueX - sumColGap - sumLabelWidth;

  // Phase 11b — Layout-Hooks (Kopf/Tabellenstil/Summenlinie/Fusszeile) statt fest
  // verdrahteter Zeichenlogik; `standard` reproduziert das bisherige Layout exakt.
  const layout = getLayout(theme.layoutId);
  const base = theme.brand.fontSizePt + layout.fontDelta; // Phase 11b: fontSizePt wird erstmals konsumiert
  const frame: LayoutFrame = { doc, theme, margins, left, right, width: right - left, primary: theme.brand.primaryColor, base };
  // Phase 11b, Task 5 — Zeilenhoehe der Positionstabelle war bisher fest 16pt (passend
  // zur Standard-Schriftgroesse 10pt); `kompakt` (fontDelta -1, base 9) braucht engere
  // Zeilen. `rowH` skaliert proportional zu `base` (16 bei base 10, 14 bei base 9) und
  // ist byte-kompatibel zum bisherigen Wert fuer alle Layouts ohne `fontDelta`.
  const rowH = Math.round((base - 1) * 1.8);
  const discountRowH = Math.round(rowH * 0.8); // vorher fest 13 (= Math.round(16 * 0.8))
  // Fix-Runde 1 (Task-5-Review, Minor): HEADING- und SUBTOTAL-Zeilen hatten weiterhin
  // fest 26/16pt reservierten Platz statt proportional zu `rowH` zu skalieren — bei
  // `kompakt` blieb dadurch mehr Luft als bei den Positionszeilen. Bei `base = 10`
  // (rowH = 16) unveraendert: `headingRowH` = round(16 * 1.6) = 26, SUBTOTAL bleibt `rowH`
  // = 16.
  const headingRowH = Math.round(rowH * 1.6); // vorher fest 26

  // Fix-Welle (Abschluss-Review, Block 3 "Minor" — `modern`-Chrome inkonsistent):
  // `drawPageChrome` (der farbige Balken von `modern` auf Folgeseiten) wurde bisher NUR
  // von `ensureSpace`/`ensurePlainSpace` direkt nach einem MANUELLEN `doc.addPage()`
  // aufgerufen. Seiten, die pdfkit SELBST automatisch anlegt (z. B. wenn ein `doc.text()`
  // im Schlussblock ohne vorherigen `ensurePlainSpace`-Schutz nahe dem Seitenende
  // umbricht), loesten zwar denselben `pageAdded`-Event aus (der bisher nur den
  // Hintergrund neu zeichnete), aber NIE das Kopf-Chrome — Seite 2 blieb dann ohne
  // Farbbalken. Jetzt zeichnet der `pageAdded`-Handler selbst Hintergrund UND Chrome fuer
  // JEDEN `doc.addPage()` (manuell wie automatisch) und merkt sich die vom Hook
  // gelieferte Start-y in `chromeStartY`; `ensureSpace`/`ensurePlainSpace` lesen diese
  // Variable nur noch, statt den Hook selbst (und damit potenziell doppelt) aufzurufen.
  let chromeStartY: number | undefined;
  doc.on("pageAdded", () => {
    drawBackground(doc, theme);
    const chromeResult = layout.drawPageChrome?.(frame);
    chromeStartY = typeof chromeResult === "number" ? chromeResult : undefined;
  });

  const meta: KopfMetaRow[] = [{ label: "Rechnungsdatum", value: deDate(data.issueDate) }];
  if (data.deliveryDate) meta.push({ label: "Leistungsdatum", value: deDate(data.deliveryDate) });
  if (data.dueDate) meta.push({ label: "Fällig am", value: deDate(data.dueDate) });
  // Fix-Welle (Abschluss-Review Phase 11b, Block 3 — Referenzbeleg RE-41362): nach den
  // Nummer-/Datumszeilen, fuer ALLE Layouts (die `meta`-Zeilen werden von jedem
  // `layout.drawKopf` gemeinsam genutzt) — "Ihre Kundennummer" nur, wenn der Kaeufer eine
  // hat (Customer.customerNumber, Phase 7 §34); "Ihr Ansprechpartner" nur, wenn der
  // Verkaeufer-Snapshot einen Kontaktnamen traegt (`data.seller.contactName`, aktuell ohne
  // eigene Datenquelle in den Buildern — siehe mapper.ts/pdf-data.ts).
  if (data.buyer.customerNumber) meta.push({ label: "Ihre Kundennummer", value: data.buyer.customerNumber });
  if (data.seller.contactName) meta.push({ label: "Ihr Ansprechpartner", value: data.seller.contactName });
  if (data.buyer.vatId) meta.push({ label: "USt-IdNr. Empfänger", value: data.buyer.vatId });
  // Phase 5 — Bezug zur Quelle (Angebot/Auftrag/Lieferschein) bei Teil-/Abschlags-/
  // Schlussrechnung, NUR fürs PDF-Layout (kein XML-Feld).
  if (data.sourceNumber) meta.push({ label: "Bezug", value: `zu ${data.sourceLabel ?? "Beleg"} ${data.sourceNumber}` });

  // Kopf: Logo, Absenderzeile, Empfänger, Titel, Meta, Kopftext (Platzhalter bereits
  // aufgeloest, siehe buildEInvoiceData/buildDocEInvoiceData) — y danach dynamisch
  // (Rueckgabewert des Hooks), kein hartes Ueberschreiben, da pdfkit bei langem Text
  // automatisch umbricht/seitenwechselt.
  let y = layout.drawKopf(frame, {
    title: documentTitle(data),
    numberLabel: documentNumberLabel(data),
    number: data.number,
    meta,
    recipient: data.buyer,
    senderFallback: `${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`,
    intro: data.headerText,
  });

  // Positions-Tabelle — Spalten nach Druckoptionen (§36).
  const { columns, x: colX } = buildItemColumns(data, theme.options, right - left - 4, layout.labels);
  const tableX = left + 4;

  // Manuelle Paginierung: pdfkit bricht bei einem `doc.text(...)` nahe dem unteren Rand
  // selbst eine neue Seite an (auch bei EXPLIZITEN x/y), OHNE unsere eigene, absolut
  // geführte `y`-Variable zu kennen — jede folgende Zeile würde dann mit einem bereits
  // "zu großen" y erneut (und erneut) eine Seite anbrechen (kaskadierende Leerseiten bei
  // langen Belegen). Daher VOR jeder Zeile selbst prüfen und bei Bedarf explizit
  // umbrechen (inkl. wiederholter Tabellenkopf), statt pdfkit entscheiden zu lassen.
  //
  // Fix-Runde 2 (Koordinator, Critical): seit Fix-Runde 1 (Punkt 6) zeichnet
  // `layout.drawFooter` die Fusszeile auf JEDER Seite (footY = Seitenunterkante -
  // `layout.footerHeight`) — `pageBottom` reservierte diesen Bereich bisher NICHT, sodass
  // Positions-/Summenzeilen in das Fusszeilen-Band hineinragen konnten (verifiziert: 60
  // Positionen ueberlappten auf Seite 1). Bei aktiver Fusszeile reserviert `pageBottom`
  // jetzt zusaetzlich `layout.footerHeight` plus 6pt Sicherheitsabstand; `footY` selbst
  // bleibt unveraendert (Fusszeile/GiroCode-Position aendern sich nicht).
  const pageBottom = theme.options.showFooter ? doc.page.height - margins.bottom - layout.footerHeight - 6 : doc.page.height - margins.bottom;

  const drawTableHeader = (atY: number): number =>
    drawTableHeaderRow(
      frame,
      layout,
      columns.map((col) => ({ header: col.header, x: tableX + colX[col.key]!, width: col.width, align: col.align, isDescription: col.key === "desc" })),
      atY,
      theme.options.showDescription,
    );

  const ensureSpace = (atY: number, needed: number): number => {
    if (atY + needed <= pageBottom) return atY;
    doc.addPage();
    // Phase 11b, Task 4 — Kopf-"Chrome" auf Folgeseiten (z. B. der Balken von `modern`);
    // liefert der Hook eine Zahl, ersetzt sie die bisherige feste Start-y (margins.top).
    // Fix-Welle: `chromeStartY` wird vom `pageAdded`-Handler gesetzt (siehe oben) — hier
    // NICHT mehr selbst `drawPageChrome` aufrufen (sonst Doppel-Zeichnung).
    return drawTableHeader(typeof chromeStartY === "number" ? chromeStartY : margins.top);
  };

  y = drawTableHeader(y);

  // Phase 4b (§8): Zwischensummen (SUBTOTAL) rechnen sich ausschließlich aus den
  // ITEM-Nettobeträgen seit der letzten HEADING/SUBTOTAL-Zeile (computeSubtotals).
  const subtotals = computeSubtotals(data.lines.map((l) => ({ lineType: lineType(l), lineNetCents: l.lineNetCents })));

  const descX = tableX + colX.desc!;
  const descWidth = columns.find((c) => c.key === "desc")!.width;
  const showDescription = theme.options.showDescription;

  doc.fillColor("#000").fontSize(base - 1);
  let itemPos = 0;
  data.lines.forEach((line, i) => {
    const type = lineType(line);

    if (type === "HEADING") {
      y = ensureSpace(y, headingRowH);
      doc.font("Helvetica-Bold").fontSize(base).fillColor("#000");
      doc.text(line.description, left, y, { width: right - left });
      doc.font("Helvetica").fontSize(base - 1);
      y = doc.y + 6;
      return;
    }

    if (type === "TEXT") {
      const blocks = parseRichText(line.descriptionLong ?? line.description);
      doc.fillColor("#000");
      // renderRichTextPdf schreibt ab doc.y (pdfkit-Cursor) — mit der eigenen
      // Layout-Variablen y synchronisieren, bevor gerendert wird.
      doc.y = y;
      renderRichTextPdf(doc, blocks, { x: left, width: right - left, fontSize: base - 1 });
      y = doc.y + 4;
      return;
    }

    if (type === "SUBTOTAL") {
      y = ensureSpace(y, rowH);
      doc.font("Helvetica-Bold").fontSize(base - 1).fillColor("#000");
      doc.text(line.description, sumLabelX, y, { width: sumLabelWidth, align: "right" });
      if (theme.options.showLineTotals) {
        doc.text(formatCents(subtotals[i] ?? 0, cur), sumValueX, y, { width: sumValueWidth, align: "right" });
      }
      doc.font("Helvetica").fontSize(base - 1);
      y += rowH;
      return;
    }

    // ITEM
    itemPos += 1;
    const h = rowH;
    y = ensureSpace(y, h);
    if (layout.table.zebra && itemPos % 2 === 0) {
      doc.rect(left, y - 2, right - left, h).fill(layout.table.zebra);
      doc.fillColor(layout.table.textColor);
    }
    // Fix-Welle (Abschluss-Review, Block 3): `schlicht` nummeriert die Referenz-Positionen
    // "1." statt "1" — `labels.colPosSuffix` haengt ein optionales Suffix an.
    doc.text(`${itemPos}${layout.labels?.colPosSuffix ?? ""}`, tableX + colX.pos!, y, { width: 28 });
    if (colX.artNr != null) doc.text(line.articleNumber ?? "", tableX + colX.artNr, y, { width: 55 });
    if (showDescription) {
      if (layout.table.boldTitle) doc.font("Helvetica-Bold");
      doc.text(line.description, descX, y, { width: descWidth });
      if (layout.table.boldTitle) doc.font("Helvetica");
    }
    doc.text(`${formatQuantity(line.quantityMilli)} ${line.unit}`, tableX + colX.menge!, y, { width: 50, align: "right" });
    doc.text(formatCents(line.unitNetPriceCents, cur), tableX + colX.einzel!, y, { width: 70, align: "right" });
    if (colX.ust != null) doc.text(`${line.taxRate}%`, tableX + colX.ust, y, { width: 35, align: "right" });
    if (colX.netto != null) doc.text(formatCents(line.lineNetCents, cur), tableX + colX.netto, y, { width: 70, align: "right" });
    y += h;
    if (layout.table.rowRule) {
      doc.save();
      doc.lineWidth(0.3).strokeColor(layout.table.rowRule);
      doc.moveTo(left, y - 3).lineTo(right, y - 3).stroke();
      doc.restore();
    }
    // Rabattzeile unter der Position (BG-27), z. B. "abzgl. 10 % Rabatt –12,00 €".
    // Fix-Runde 1 (Koordinator, Punkt 7): "–" ist der Halbgeviertstrich (U+2013,
    // WinAnsi-Encoding) — das Minuszeichen "−" (U+2212), das hier zuvor stand, fehlt im
    // Glyphensatz der pdfkit-Standardschrift Helvetica und wird durch `"` ersetzt gerendert.
    if (line.discountCents) {
      y = ensureSpace(y, discountRowH);
      const pct = line.discountPermille ? ` ${(line.discountPermille / 10).toFixed(2).replace(/\.00$/, "")} %` : "";
      doc.fontSize(base - 2).fillColor("#555");
      if (showDescription) doc.text(`abzgl.${pct} Rabatt`, descX, y, { width: descWidth });
      if (colX.netto != null) doc.text(`–${formatCents(Math.abs(line.discountCents), cur)}`, tableX + colX.netto, y, { width: 70, align: "right" });
      doc.fillColor("#000").fontSize(base - 1);
      y += discountRowH;
    }
    // Langtext (BT-154) als Rich-Text unter der Bezeichnung, kleinere Schrift.
    if (line.descriptionLong && showDescription) {
      const blocks = parseRichText(line.descriptionLong);
      if (blocks.length > 0) {
        doc.fillColor("#333");
        doc.y = y;
        renderRichTextPdf(doc, blocks, { x: descX, width: right - descX, fontSize: base - 2 });
        doc.fillColor("#000").fontSize(base - 1);
        y = doc.y + 2;
      }
    }
  });

  // Summen: Zwischensumme netto / Rabatt / Aufschlag (je vor der Steuer),
  // dann Steuersätze und Gesamtbetrag. Wie `ensureSpace`, aber ohne Tabellenkopf
  // (kein Item-Tabellenkontext mehr) — verhindert dieselbe Kaskade bei einem knapp
  // vor Seitenende endenden Positionsblock.
  const ensurePlainSpace = (atY: number, needed: number): number => {
    if (atY + needed <= pageBottom) return atY;
    doc.addPage();
    // Fix-Welle: siehe `ensureSpace` oben — `chromeStartY` statt eines eigenen
    // `drawPageChrome`-Aufrufs.
    return typeof chromeStartY === "number" ? chromeStartY : margins.top;
  };
  y = ensurePlainSpace(y, 40);
  y += 10;
  layout.drawTotalsRule(frame, sumLabelX, y);
  y += 6;
  const sumRow = (label: string, value: string, bold = false) => {
    y = ensurePlainSpace(y, 16);
    // Fix-Welle (Abschluss-Review, Block 3 "Minor"): war fest `fontSize(10)` — bei
    // `kompakt` (base 9) oder einem hoeheren `fontSizePt` folgte der Summenblock der
    // Tabellenschrift bisher nicht. `base` = `theme.brand.fontSizePt + layout.fontDelta`
    // (siehe oben) — bei den Defaults (fontSizePt 10, `standard`/`kompakt`s eigener
    // fontDelta bereits in `base` eingerechnet) identisch zum bisherigen Wert 10.
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(base);
    doc.text(label, sumLabelX, y, { width: sumLabelWidth, align: "right" });
    doc.text(value, sumValueX, y, { width: sumValueWidth, align: "right" });
    y += 16;
  };
  const lineTotal = data.lineTotalCents ?? data.netTotalCents;
  const allowanceTotal = data.allowanceTotalCents ?? 0;
  const chargeTotal = data.chargeTotalCents ?? 0;
  // Gutschriften spiegeln die Betraege (negativ, Bestandskonvention). Der Block wird
  // vorzeichenrichtig ausgegeben (Zwischensumme -100,00 / Rabatt +10,00 / Netto -90,00),
  // nur die Sichtbarkeit prueft den Betrag.
  if (allowanceTotal !== 0 || chargeTotal !== 0) {
    sumRow("Zwischensumme netto", formatCents(lineTotal, cur));
    if (allowanceTotal !== 0) sumRow("abzgl. Rabatt", formatCents(-allowanceTotal, cur));
    if (chargeTotal !== 0) {
      const chargeReason = data.documentCharges?.[0]?.reason;
      sumRow(chargeReason ? `zzgl. Aufschlag (${chargeReason})` : "zzgl. Aufschlag", formatCents(chargeTotal, cur));
    }
  }
  // Phase 5 — Schlussrechnung: der Summenblock weist die GESAMTLEISTUNG aus (alle
  // Positionen der Quelle), nicht nur den Restbetrag — daher eigene Beschriftung, die
  // (Fix-Welle, Abschluss-Review Block 3) unveraendert bleibt, auch bei einem Layout mit
  // eigenen `labels` (z. B. `schlicht`) — nur der Nicht-FINAL-Wortlaut ist ueberschreibbar.
  const isFinal = data.type === "FINAL";
  const labels = layout.labels;
  sumRow(isFinal ? "Gesamtleistung netto" : (labels?.net ?? "Nettobetrag"), formatCents(data.netTotalCents, cur));
  for (const t of data.taxSubtotals) {
    if (t.taxCents > 0) sumRow(labels?.taxRow?.(t.taxRate) ?? `zzgl. ${t.taxRate}% USt`, formatCents(t.taxCents, cur));
  }
  sumRow(isFinal ? "Gesamtleistung brutto" : (labels?.gross ?? "Gesamtbetrag"), formatCents(data.grossTotalCents, cur), true);

  // Phase 5 (§14 Abs. 5 S. 2 UStG) — je abgesetzter Abschlagsrechnung eine Abzugszeile,
  // dann fett der Restbetrag (= data.payableCents, aus dem Abzugs-Snapshot berechnet).
  if (isFinal && data.deductions?.length) {
    doc.font("Helvetica").fontSize(base - 1).fillColor("#333");
    for (const d of data.deductions) {
      doc.text(
        // Fix-Runde 1, Punkt 7 — "–" (En-Dash, U+2013) statt "−" (Minuszeichen, U+2212):
        // Letzteres fehlt im Glyphensatz von Helvetica (pdfkit-Standardschrift).
        `abzüglich Abschlagsrechnung ${d.number} vom ${deDate(d.issueDate)} –${formatCents(d.grossCents, cur)} (enthaltene USt ${formatCents(d.taxCents, cur)})`,
        sumLabelX,
        y,
        { width: right - sumLabelX, align: "right" },
      );
      y = doc.y + 4;
    }
    doc.fillColor("#000").fontSize(base);
    sumRow("Restbetrag", formatCents(data.payableCents, cur), true);
  }
  doc.font("Helvetica");

  // GiroCode (§37) — Eligibilitaet EINMAL geprueft, fuer beide Platzierungen (siehe unten
  // und der `bottom-right`-Block kurz vor der Fusszeilen-Schleife) wiederverwendet.
  const giroEligible = Boolean(
    theme.options.showGiroCode &&
      data.iban &&
      data.currency === "EUR" && // B2 (Final-Review): EPC-QR-Codes tragen "EUR<Betrag>" fest kodiert (epc.ts) —
      // ohne diese Pruefung wuerde eine Fremdwaehrungsrechnung einen GiroCode mit falscher
      // Waehrungsangabe drucken (Kunde zahlt EUR-Betrag statt z. B. USD-Betrag).
      GIRO_ELIGIBLE_TYPES.has(data.type) &&
      (data.giroAmountCents ?? 0) > 0,
  );
  // Fix-Welle (Abschluss-Review, Block 3 — `schlicht` vs. Referenzbeleg "RE-41362"):
  // `giroPlacement === "below-totals"` zeichnet den GiroCode links DIREKT unter dem
  // Summenblock statt (wie bisher, siehe der `bottom-right`-Block unten) rechts oberhalb
  // der Fusszeile auf der letzten Seite. Das muss HIER passieren (vor Fusstext/notes/
  // paymentTermsHuman), weil `y` danach fuer diese Bloecke weiterlaeuft — der
  // `bottom-right`-Zweig bleibt dagegen bewusst am Ende der Funktion (er braucht die
  // tatsaechlich LETZTE Seite, die erst nach Fusstext/notes/paymentTermsHuman feststeht).
  if (giroEligible && layout.giroPlacement === "below-totals") {
    try {
      const payload = buildEpcPayload({
        name: data.seller.name,
        iban: data.iban!,
        bic: data.bic,
        amountCents: data.giroAmountCents!,
        remittance: data.number,
      });
      const giroSizeMm = theme.options.giroSizeMm;
      const giroSize = mm(giroSizeMm);
      const captionH = base - 3 + 6;
      y = ensurePlainSpace(y, 8 + giroSize + 3 + captionH);
      const giroY = y + 8;
      await renderGiroCode(doc, payload, { x: left, y: giroY, sizeMm: giroSizeMm });
      doc.fontSize(base - 3).fillColor("#666");
      doc.text(layout.labels?.giroCaption ?? "GiroCode – mit Banking-App scannen", left, giroY + giroSize + 3, { width: giroSize, align: "center" });
      y = giroY + giroSize + 3 + captionH;
    } catch (e) {
      // EpcError (Name > 70 Zeichen, Betrag ausserhalb des SEPA-Rahmens, Payload > 331 Byte)
      // ist kein Grund, das PDF scheitern zu lassen — der Beleg wird ohne GiroCode gerendert.
      if (!(e instanceof EpcError)) throw e;
    }
  }

  // Fusstext (Platzhalter bereits aufgeloest) — nach den Summen, vor notes/paymentTerms.
  //
  // Fix-Welle (Abschluss-Review, Block 2 "Important"): dieser gesamte Schlussblock
  // (Fusstext/DOWNPAYMENT-Hinweis/notes/paymentTermsHuman/paymentMethodText) wurde bisher
  // mit reinem `doc.text(...)` OHNE `ensurePlainSpace`-Schutz gezeichnet. `pageBottom`
  // reserviert seit Fix-Runde 2 zwar `layout.footerHeight + 6` am Seitenende, aber pdfkits
  // EIGENE automatische Paginierung kennt nur `margins.bottom` (nicht unsere Reservierung)
  // — ein y-Wert im Band dazwischen (hier 52pt: footerHeight 46 + 6pt Sicherheitsabstand)
  // loeste bei pdfkit KEINEN Seitenumbruch aus und der Text landete auf der Fusszeile.
  // Jeder Block bekommt jetzt vorab `y = ensurePlainSpace(y, 30)` (dieselbe 30pt-Schwelle
  // wie im Pendant `delivery-note-pdf.ts:285-289`) und liest seine tatsaechliche Hoehe
  // danach explizit aus `doc.y` zurueck — die vorherige Kette aus `doc.moveDown(0.4)`-
  // Aufrufen verliess sich auf pdfkits internen Cursor, ohne dass die eigene `y`-Variable
  // je wieder synchronisiert wurde, und war daher fuer eine Paginierungspruefung ungeeignet.
  if (data.footerText) {
    y = ensurePlainSpace(y, 30);
    y += 10;
    doc.fontSize(base - 1).fillColor("#333").text(data.footerText, left, y, { width: right - left });
    y = doc.y;
  }

  // Pflichthinweise / Zahlungsbedingungen (inkl. Skonto-Absatz aus paymentTermsText,
  // siehe skonto.ts — Menschentext; die #SKONTO#-Syntax bleibt dem XML vorbehalten)
  // und Zahlungsmethoden-Text (invoiceText) aus dem Snapshot.
  y += 16;
  doc.fontSize(base - 1).fillColor("#333");
  // Phase 5 (§13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG) — Anzahlungs-/Sollversteuerungs-
  // Hinweis auf jeder Abschlagsrechnung, vor den übrigen Hinweisen.
  if (data.type === "DOWNPAYMENT") {
    y = ensurePlainSpace(y, 30);
    doc.text(DOWNPAYMENT_TAX_HINT, left, y, { width: right - left });
    y = doc.y + 4;
  }
  // § 14 Abs. 4 Nr. 9 / § 14b Abs. 1 Satz 5 UStG — Aufbewahrungshinweis fuer den privaten
  // Leistungsempfaenger (Bauleistung am Grundstueck). Nur auf ausdruecklichen Schalter:
  // "Bauleistung" ist maschinell nicht erkennbar.
  if (data.consumerRetentionHint) {
    y = ensurePlainSpace(y, 30);
    doc.text(CONSUMER_RETENTION_HINT, left, y, { width: right - left });
    y = doc.y + 4;
  }
  if (data.notes) {
    y = ensurePlainSpace(y, 30);
    doc.text(data.notes, left, y, { width: right - left });
    y = doc.y;
  }
  // Fix-Runde 1 (Befund C): paymentTermsHuman traegt bei Skonto den Klartext ohne
  // #SKONTO#-Tags; ohne Skonto identisch zu paymentTerms (Alt-Belege unveraendert).
  // Fix-Runde 1 (Koordinator, §33 DocumentSettings.showPaymentTermsText): diese Zeile
  // ("Zahlbar bis ..."/Skonto-Klartext) nur, wenn die Einstellung an ist.
  const paymentTermsHuman = data.paymentTermsHuman ?? data.paymentTerms;
  if (paymentTermsHuman && theme.showPaymentTermsText) {
    y = ensurePlainSpace(y, 30);
    y += 5; // entspricht in etwa dem vorherigen `doc.moveDown(0.4)` bei 9pt Schrift
    doc.text(paymentTermsHuman, left, y, { width: right - left });
    y = doc.y;
  }
  if (data.paymentMethodText) {
    y = ensurePlainSpace(y, 30);
    y += 5;
    doc.text(data.paymentMethodText, left, y, { width: right - left });
    y = doc.y;
  }

  // Fix-Runde 1 (Koordinator, Punkt 6): die Fusszeile wird jetzt auf JEDER Seite gezeichnet
  // (vorher nur auf der zuletzt angelegten — `layout.drawFooter` lief vor der Seiten-
  // Schleife unten, statt in ihr). `footY` bleibt trotzdem vor der Schleife berechnet, da
  // GiroCode (nur letzte Seite) denselben Wert braucht und alle Seiten dieselbe Groesse
  // haben (kein `doc.page.height`-Unterschied je Seite in diesem Renderer).
  const footY = doc.page.height - margins.bottom - layout.footerHeight;

  // GiroCode (§37) — im Zahlungsblock rechts oberhalb der Fusszeile, Kantenlaenge aus
  // `theme.options.giroSizeMm` (Phase 12a, vorher fest 30 mm),
  // NUR auf der zuletzt gerenderten Seite (`doc.page` zeigt hier noch auf sie, vor dem
  // `switchToPage` in der Schleife unten). Fix-Welle: NUR fuer `giroPlacement !==
  // "below-totals"` — der `below-totals`-Zweig hat weiter oben (vor Fusstext/notes/
  // paymentTermsHuman) bereits gezeichnet, `giroEligible` wird von dort wiederverwendet.
  if (giroEligible && layout.giroPlacement !== "below-totals") {
    try {
      const payload = buildEpcPayload({
        name: data.seller.name,
        iban: data.iban!,
        bic: data.bic,
        amountCents: data.giroAmountCents!,
        remittance: data.number,
      });
      const giroSizeMm = theme.options.giroSizeMm;
      const giroSize = mm(giroSizeMm);
      const giroX = right - giroSize;
      // Fix-Runde 1 (Koordinator, Punkt 8): 14 -> 22pt Abstand zu `footY` — bei Layouts mit
      // `footerHeight` > 32 (z. B. `schlicht`/`standard` seit der AUTO-Fusszeile, 44/46pt)
      // kollidierte die GiroCode-Bildunterschrift sonst mit der vierten Fusszeilen-Spalte.
      const giroY = footY - giroSize - 22;
      // Fix-Welle 12a (M2): `giroY` ist eine feste Position ohne Abgleich mit dem
      // Inhaltscursor `y` (Fusstext/Hinweise/Zahlungsbedingungen). Mit der neuen
      // Obergrenze `giroSizeMm = 40` (vorher fest 30) rueckt der GiroCode auf einer
      // knapp gefuellten letzten Seite weiter nach oben und kann `y` ueberlagern.
      // Kollidiert die berechnete Position mit dem Inhalt, wird der GiroCode auf
      // dieser Seite ausgelassen statt ueberlappend gedruckt — kein Layoutumbau
      // (neue Seite erzwingen) im Rahmen dieser Fix-Welle.
      if (giroY > y + 6) {
        await renderGiroCode(doc, payload, { x: giroX, y: giroY, sizeMm: giroSizeMm });
        // Fix-Welle (Abschluss-Review, Block 3 "Minor"): war fest `fontSize(7)`.
        doc.fontSize(base - 3).fillColor("#666");
        doc.text(layout.labels?.giroCaption ?? "GiroCode – mit Banking-App scannen", giroX, giroY + giroSize + 3, { width: giroSize, align: "center" });
      }
    } catch (e) {
      // EpcError (Name > 70 Zeichen, Betrag ausserhalb des SEPA-Rahmens, Payload > 331 Byte)
      // ist kein Grund, das PDF scheitern zu lassen — der Beleg wird ohne GiroCode gerendert.
      if (!(e instanceof EpcError)) throw e;
    }
  }

  // Fusszeile (jede Seite) + Falz-/Lochmarken + Seitenzahlen — erst nach dem gesamten
  // Inhalt (Seitenzahlen brauchen die fertige Gesamtseitenzahl, `bufferPages: true`).
  const footerColumns = buildFooterColumns({ seller: data.seller, iban: data.iban, bic: data.bic, bankName: data.bankName, ...theme.footerFacts }, theme.brand);
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    if (theme.options.showFooter) layout.drawFooter(frame, footerColumns, footY);
    if (theme.options.foldMarks) drawFoldMarks(doc);
    if (theme.options.punchMarks) drawPunchMark(doc);
    if (theme.watermark) drawWatermark(doc, theme.watermark);
  }
  if (theme.options.showPageNumbers) drawPageNumbers(doc, theme);

  doc.end();
  return finished;
}
