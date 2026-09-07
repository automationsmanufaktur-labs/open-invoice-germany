/**
 * Erzeugt ein PDF einer Rechnung ("sonstige Rechnung" i.S.d. § 14 UStG).
 * Layout enthält alle Pflichtangaben; für B2B-E-Rechnungen ist zusätzlich der
 * XRechnung-/ZUGFeRD-Export maßgeblich (XML ist führend).
 *
 * Phase 7, Task 3 (§35-§37): Briefpapier (Logo/Farbe/Ränder/Fusszeilen), Druckoptionen
 * (Spalten/Marken/Seitenzahlen/GiroCode) kommen aus einem `PdfTheme` (siehe
 * `src/domain/settings/theme.ts#loadPdfTheme`) statt aus Konstanten.
 */
import PDFDocument from "pdfkit";
import { formatCents, formatQuantity } from "@/lib/money";
import { parseRichText, renderRichTextPdf } from "@/lib/richtext";
import { computeSubtotals } from "@/domain/document/lines";
import type { EInvoiceData, EInvoiceLine } from "@/lib/einvoice/types";
import type { PdfTheme } from "./theme";
import { mm, drawFoldMarks, drawPunchMark, drawPageNumbers, concatPdfChunks } from "./marks";
import { pdfMargins, drawBackground, drawLogo, drawSenderLine, drawBrandedFooter } from "./layout";
import { buildEpcPayload, EpcError } from "./epc";
import { renderGiroCode } from "./giro";

function lineType(line: EInvoiceLine): "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL" {
  return line.lineType ?? "ITEM";
}

const TYPE_TITLE: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift / Storno",
  CORRECTION: "Korrekturrechnung",
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

// Phase 7 (§37) — GiroCode nur für die Rechnungs-Familie, nie für Gutschrift oder
// Geschäftsdokumente (Angebot/AB/Proforma erzeugen ohnehin kein giroAmountCents).
const GIRO_ELIGIBLE_TYPES = new Set(["INVOICE", "PARTIAL", "DOWNPAYMENT", "FINAL", "CORRECTION"]);
const GIRO_SIZE_MM = 30;

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
): { columns: ItemColumn[]; x: Partial<Record<ItemColumn["key"], number>> } {
  const showArticleNumber = options.showArticleNumber && data.lines.some((l) => lineType(l) === "ITEM" && l.articleNumber);
  const showTax = options.showTaxRatePerLine;
  const showNetto = options.showLineTotals;

  const columns: ItemColumn[] = [{ key: "pos", header: "Pos.", width: 28 }];
  if (showArticleNumber) columns.push({ key: "artNr", header: "Art.-Nr.", width: 55 });
  columns.push({ key: "desc", header: "Beschreibung", width: 0 }); // Breite unten aufgefüllt
  columns.push({ key: "menge", header: "Menge", width: 50, align: "right" });
  columns.push({ key: "einzel", header: "Einzel", width: 70, align: "right" });
  if (showTax) columns.push({ key: "ust", header: "USt", width: 35, align: "right" });
  if (showNetto) columns.push({ key: "netto", header: "Netto", width: 70, align: "right" });

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
  // pdfkit angelegte) Seite, daher hier zusätzlich einmal manuell.
  doc.on("pageAdded", () => drawBackground(doc, theme));
  drawBackground(doc, theme);

  const cur = data.currency;
  const left = margins.left;
  const right = doc.page.width - margins.right;
  const titleColor = theme.brand.primaryColor;

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

  drawLogo(doc, theme, right, margins.top);

  // Kopf: Absender (Briefpapier-Absenderzeile, sonst der bisherige Fallback-Text)
  const senderFallback = `${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`;
  drawSenderLine(doc, theme, left, margins.top, senderFallback);

  // Empfänger
  const buyerY = margins.top + 60;
  doc.fillColor("#000").fontSize(11);
  doc.text(data.buyer.name, left, buyerY);
  if (data.buyer.contactName) doc.text(data.buyer.contactName);
  doc.text(data.buyer.addressLine1);
  if (data.buyer.addressLine2) doc.text(data.buyer.addressLine2);
  doc.text(`${data.buyer.postalCode} ${data.buyer.city}`);

  // Titel + Meta (rechts)
  doc.fontSize(18).fillColor(titleColor).text(TYPE_TITLE[data.type] ?? "Rechnung", left, buyerY, { align: "right" });
  doc.fontSize(10).fillColor("#333");
  const metaTop = margins.top + 90;
  doc.text(`${NUMBER_LABEL[data.type] ?? "Nummer"}: ${data.number}`, left + 250, metaTop, { align: "right" });
  doc.text(`Rechnungsdatum: ${deDate(data.issueDate)}`, { align: "right" });
  if (data.deliveryDate) doc.text(`Leistungsdatum: ${deDate(data.deliveryDate)}`, { align: "right" });
  if (data.dueDate) doc.text(`Fällig am: ${deDate(data.dueDate)}`, { align: "right" });
  if (data.buyer.vatId) doc.text(`USt-IdNr. Empfänger: ${data.buyer.vatId}`, { align: "right" });
  // Phase 5 — Bezug zur Quelle (Angebot/Auftrag/Lieferschein) bei Teil-/Abschlags-/
  // Schlussrechnung, NUR fürs PDF-Layout (kein XML-Feld).
  if (data.sourceNumber) doc.text(`Bezug: zu ${data.sourceLabel ?? "Beleg"} ${data.sourceNumber}`, { align: "right" });

  // Kopftext (Platzhalter bereits aufgeloest, siehe buildEInvoiceData/buildDocEInvoiceData).
  // Nach dem Meta-Block, vor der Positions-Tabelle — y danach dynamisch (doc.y), kein
  // hartes Ueberschreiben, da pdfkit bei langem Text automatisch umbricht/seitenwechselt.
  let y = margins.top + 170;
  if (data.headerText) {
    doc.fontSize(9).fillColor("#333").text(data.headerText, left, y, { width: right - left });
    y = doc.y + 10;
  }

  // Positions-Tabelle — Spalten nach Druckoptionen (§36).
  const { columns, x: colX } = buildItemColumns(data, theme.options, right - left - 4);
  const tableX = left + 4;

  // Manuelle Paginierung: pdfkit bricht bei einem `doc.text(...)` nahe dem unteren Rand
  // selbst eine neue Seite an (auch bei EXPLIZITEN x/y), OHNE unsere eigene, absolut
  // geführte `y`-Variable zu kennen — jede folgende Zeile würde dann mit einem bereits
  // "zu großen" y erneut (und erneut) eine Seite anbrechen (kaskadierende Leerseiten bei
  // langen Belegen). Daher VOR jeder Zeile selbst prüfen und bei Bedarf explizit
  // umbrechen (inkl. wiederholter Tabellenkopf), statt pdfkit entscheiden zu lassen.
  const pageBottom = doc.page.height - margins.bottom;

  const drawTableHeader = (atY: number): number => {
    doc.fontSize(9).fillColor("#fff");
    doc.rect(left, atY, right - left, 18).fill("#1f2937");
    doc.fillColor("#fff");
    for (const col of columns) {
      if (col.key === "desc" && !theme.options.showDescription) continue;
      doc.text(col.header, tableX + colX[col.key]!, atY + 5, { width: col.width, align: col.align ?? "left" });
    }
    doc.fillColor("#000").fontSize(9);
    return atY + 22;
  };

  const ensureSpace = (atY: number, needed: number): number => {
    if (atY + needed <= pageBottom) return atY;
    doc.addPage();
    return drawTableHeader(margins.top);
  };

  y = drawTableHeader(y);

  // Phase 4b (§8): Zwischensummen (SUBTOTAL) rechnen sich ausschließlich aus den
  // ITEM-Nettobeträgen seit der letzten HEADING/SUBTOTAL-Zeile (computeSubtotals).
  const subtotals = computeSubtotals(data.lines.map((l) => ({ lineType: lineType(l), lineNetCents: l.lineNetCents })));

  const descX = tableX + colX.desc!;
  const descWidth = columns.find((c) => c.key === "desc")!.width;
  const showDescription = theme.options.showDescription;

  doc.fillColor("#000").fontSize(9);
  let itemPos = 0;
  data.lines.forEach((line, i) => {
    const type = lineType(line);

    if (type === "HEADING") {
      y = ensureSpace(y, 26);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
      doc.text(line.description, left, y, { width: right - left });
      doc.font("Helvetica").fontSize(9);
      y = doc.y + 6;
      return;
    }

    if (type === "TEXT") {
      const blocks = parseRichText(line.descriptionLong ?? line.description);
      doc.fillColor("#000");
      // renderRichTextPdf schreibt ab doc.y (pdfkit-Cursor) — mit der eigenen
      // Layout-Variablen y synchronisieren, bevor gerendert wird.
      doc.y = y;
      renderRichTextPdf(doc, blocks, { x: left, width: right - left, fontSize: 9 });
      y = doc.y + 4;
      return;
    }

    if (type === "SUBTOTAL") {
      y = ensureSpace(y, 16);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
      doc.text(line.description, sumLabelX, y, { width: sumLabelWidth, align: "right" });
      if (theme.options.showLineTotals) {
        doc.text(formatCents(subtotals[i] ?? 0, cur), sumValueX, y, { width: sumValueWidth, align: "right" });
      }
      doc.font("Helvetica").fontSize(9);
      y += 16;
      return;
    }

    // ITEM
    itemPos += 1;
    const h = 16;
    y = ensureSpace(y, h);
    doc.text(String(itemPos), tableX + colX.pos!, y, { width: 28 });
    if (colX.artNr != null) doc.text(line.articleNumber ?? "", tableX + colX.artNr, y, { width: 55 });
    if (showDescription) doc.text(line.description, descX, y, { width: descWidth });
    doc.text(`${formatQuantity(line.quantityMilli)} ${line.unit}`, tableX + colX.menge!, y, { width: 50, align: "right" });
    doc.text(formatCents(line.unitNetPriceCents, cur), tableX + colX.einzel!, y, { width: 70, align: "right" });
    if (colX.ust != null) doc.text(`${line.taxRate}%`, tableX + colX.ust, y, { width: 35, align: "right" });
    if (colX.netto != null) doc.text(formatCents(line.lineNetCents, cur), tableX + colX.netto, y, { width: 70, align: "right" });
    y += h;
    // Rabattzeile unter der Position (BG-27), z. B. "abzgl. 10 % Rabatt −12,00 €".
    if (line.discountCents) {
      y = ensureSpace(y, 13);
      const pct = line.discountPermille ? ` ${(line.discountPermille / 10).toFixed(2).replace(/\.00$/, "")} %` : "";
      doc.fontSize(8).fillColor("#555");
      if (showDescription) doc.text(`abzgl.${pct} Rabatt`, descX, y, { width: descWidth });
      if (colX.netto != null) doc.text(`−${formatCents(Math.abs(line.discountCents), cur)}`, tableX + colX.netto, y, { width: 70, align: "right" });
      doc.fillColor("#000").fontSize(9);
      y += 13;
    }
    // Langtext (BT-154) als Rich-Text unter der Bezeichnung, kleinere Schrift.
    if (line.descriptionLong && showDescription) {
      const blocks = parseRichText(line.descriptionLong);
      if (blocks.length > 0) {
        doc.fillColor("#333");
        doc.y = y;
        renderRichTextPdf(doc, blocks, { x: descX, width: right - descX, fontSize: 8 });
        doc.fillColor("#000").fontSize(9);
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
    return margins.top;
  };
  y = ensurePlainSpace(y, 40);
  y += 10;
  doc.moveTo(sumLabelX, y).lineTo(right, y).strokeColor(titleColor).stroke();
  y += 6;
  const sumRow = (label: string, value: string, bold = false) => {
    y = ensurePlainSpace(y, 16);
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
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
  // Positionen der Quelle), nicht nur den Restbetrag — daher eigene Beschriftung.
  const isFinal = data.type === "FINAL";
  sumRow(isFinal ? "Gesamtleistung netto" : "Nettobetrag", formatCents(data.netTotalCents, cur));
  for (const t of data.taxSubtotals) {
    if (t.taxCents > 0) sumRow(`zzgl. ${t.taxRate}% USt`, formatCents(t.taxCents, cur));
  }
  sumRow(isFinal ? "Gesamtleistung brutto" : "Gesamtbetrag", formatCents(data.grossTotalCents, cur), true);

  // Phase 5 (§14 Abs. 5 S. 2 UStG) — je abgesetzter Abschlagsrechnung eine Abzugszeile,
  // dann fett der Restbetrag (= data.payableCents, aus dem Abzugs-Snapshot berechnet).
  if (isFinal && data.deductions?.length) {
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    for (const d of data.deductions) {
      doc.text(
        `abzüglich Abschlagsrechnung ${d.number} vom ${deDate(d.issueDate)} −${formatCents(d.grossCents, cur)} (enthaltene USt ${formatCents(d.taxCents, cur)})`,
        sumLabelX,
        y,
        { width: right - sumLabelX, align: "right" },
      );
      y = doc.y + 4;
    }
    doc.fillColor("#000").fontSize(10);
    sumRow("Restbetrag", formatCents(data.payableCents, cur), true);
  }
  doc.font("Helvetica");

  // Fusstext (Platzhalter bereits aufgeloest) — nach den Summen, vor notes/paymentTerms.
  if (data.footerText) {
    y += 10;
    doc.fontSize(9).fillColor("#333").text(data.footerText, left, y, { width: right - left });
    y = doc.y;
  }

  // Pflichthinweise / Zahlungsbedingungen (inkl. Skonto-Absatz aus paymentTermsText,
  // siehe skonto.ts — Menschentext; die #SKONTO#-Syntax bleibt dem XML vorbehalten)
  // und Zahlungsmethoden-Text (invoiceText) aus dem Snapshot.
  y += 16;
  doc.fontSize(9).fillColor("#333");
  // Phase 5 (§13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG) — Anzahlungs-/Sollversteuerungs-
  // Hinweis auf jeder Abschlagsrechnung, vor den übrigen Hinweisen.
  if (data.type === "DOWNPAYMENT") {
    doc.text(DOWNPAYMENT_TAX_HINT, left, y, { width: right - left });
    y = doc.y + 4;
  }
  if (data.notes) doc.text(data.notes, left, y, { width: right - left });
  // Fix-Runde 1 (Befund C): paymentTermsHuman traegt bei Skonto den Klartext ohne
  // #SKONTO#-Tags; ohne Skonto identisch zu paymentTerms (Alt-Belege unveraendert).
  // Fix-Runde 1 (Koordinator, §33 DocumentSettings.showPaymentTermsText): diese Zeile
  // ("Zahlbar bis ..."/Skonto-Klartext) nur, wenn die Einstellung an ist.
  const paymentTermsHuman = data.paymentTermsHuman ?? data.paymentTerms;
  if (paymentTermsHuman && theme.showPaymentTermsText) doc.moveDown(0.4).text(paymentTermsHuman, { width: right - left });
  if (data.paymentMethodText) doc.moveDown(0.4).text(data.paymentMethodText, { width: right - left });

  // Fußzeile: Aussteller-Pflichtangaben (nur wenn options.showFooter an ist).
  const footY = doc.page.height - margins.bottom - 32;
  if (theme.options.showFooter) {
    // S3 (Fix-Welle): drawBrandedFooter() liefert `true`, wenn es die Briefpapier-
    // Fusszeile (footerLeft/-Center/-Right) tatsaechlich gezeichnet hat — dann NICHT
    // zusaetzlich den hartcodierten Aussteller-/Bank-Fallback zeichnen (vorher standen
    // beide Bloecke uebereinander, 11pt Abstand bei 8pt Schrift ueberschrieb die
    // Marken-Fusszeile bei einer zweizeiligen Spalte). Ohne Briefpapier-Fusszeile bleibt
    // der bisherige Fallback (Aussteller-Pflichtangaben) erhalten.
    const branded = drawBrandedFooter(doc, theme, left, right, footY - 11);
    if (!branded) {
      doc.fontSize(8).fillColor("#666");
      const sellerLine = [
        data.seller.name,
        `${data.seller.addressLine1}, ${data.seller.postalCode} ${data.seller.city}`,
        data.seller.taxNumber ? `Steuernr.: ${data.seller.taxNumber}` : null,
        data.seller.vatId ? `USt-IdNr.: ${data.seller.vatId}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      doc.text(sellerLine, left, footY, { width: right - left, align: "center" });
      const bankLine = [
        data.bankName ? `Bank: ${data.bankName}` : null,
        data.iban ? `IBAN: ${data.iban}` : null,
        data.bic ? `BIC: ${data.bic}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (bankLine) doc.text(bankLine, left, footY + 11, { width: right - left, align: "center" });
    }
  }

  // GiroCode (§37) — im Zahlungsblock rechts oberhalb der Fusszeile, 30 mm Kantenlaenge.
  if (
    theme.options.showGiroCode &&
    data.iban &&
    data.currency === "EUR" && // B2 (Final-Review): EPC-QR-Codes tragen "EUR<Betrag>" fest kodiert (epc.ts) —
    // ohne diese Pruefung wuerde eine Fremdwaehrungsrechnung einen GiroCode mit falscher
    // Waehrungsangabe drucken (Kunde zahlt EUR-Betrag statt z. B. USD-Betrag).
    GIRO_ELIGIBLE_TYPES.has(data.type) &&
    (data.giroAmountCents ?? 0) > 0
  ) {
    try {
      const payload = buildEpcPayload({
        name: data.seller.name,
        iban: data.iban,
        bic: data.bic,
        amountCents: data.giroAmountCents!,
        remittance: data.number,
      });
      const giroSize = mm(GIRO_SIZE_MM);
      const giroX = right - giroSize;
      const giroY = footY - giroSize - 14;
      await renderGiroCode(doc, payload, { x: giroX, y: giroY, sizeMm: GIRO_SIZE_MM });
      doc.fontSize(7).fillColor("#666");
      doc.text("GiroCode – mit Banking-App scannen", giroX, giroY + giroSize + 2, { width: giroSize, align: "center" });
    } catch (e) {
      // EpcError (Name > 70 Zeichen, Betrag ausserhalb des SEPA-Rahmens, Payload > 331 Byte)
      // ist kein Grund, das PDF scheitern zu lassen — der Beleg wird ohne GiroCode gerendert.
      if (!(e instanceof EpcError)) throw e;
    }
  }

  // Falz-/Lochmarken + Seitenzahlen — erst nach dem gesamten Inhalt (Seitenzahlen
  // brauchen die fertige Gesamtseitenzahl, `bufferPages: true`).
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    if (theme.options.foldMarks) drawFoldMarks(doc);
    if (theme.options.punchMarks) drawPunchMark(doc);
  }
  if (theme.options.showPageNumbers) drawPageNumbers(doc, theme);

  doc.end();
  return finished;
}
