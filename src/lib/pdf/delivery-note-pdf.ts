/**
 * PDF eines Lieferscheins. Layout an invoice-pdf.ts angelehnt.
 * Phase 7, Task 3 (§35-§36): Briefpapier + Druckoptionen kommen aus einem `PdfTheme`.
 */
import PDFDocument from "pdfkit";
import { formatCents, formatQuantity } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import type { PdfTheme } from "./theme";
import { drawFoldMarks, drawPunchMark, drawPageNumbers, concatPdfChunks } from "./marks";
import { pdfMargins, drawBackground, drawLogo, drawSenderLine, drawBrandedFooter } from "./layout";

export interface DeliveryNotePdfLine {
  pos: number;
  articleNumber?: string | null;
  description: string;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents?: number | null;
  taxRate?: number | null;
}

export interface DeliveryNotePdfParty {
  name: string;
  contactName?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  city: string;
}

export interface DeliveryNotePdfSeller {
  name: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  taxNumber?: string | null;
  vatId?: string | null;
  iban?: string | null;
  bic?: string | null;
  bankName?: string | null;
}

/** S7 (Fix-Welle, §36) — zusaetzlicher Block, KEIN Ersatz fuer den Empfaengerblock. */
export interface DeliveryNotePdfShippingAddress {
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  city: string;
}

export interface DeliveryNotePdfData {
  number: string;
  issueDate: Date;
  deliveryDate?: Date | null;
  shippingDate?: Date | null;
  currency: string;
  seller: DeliveryNotePdfSeller;
  buyer: DeliveryNotePdfParty;
  lines: DeliveryNotePdfLine[];
  showPrices: boolean;
  showTax: boolean;
  showArticleNumber: boolean;
  showDescription: boolean;
  /**
   * S7 (Fix-Welle, Final-Review, §36): steuert NUR den zusaetzlichen "Lieferadresse"-Block
   * aus der Standard-SHIPPING-Adresse des Kunden (`deliveryAddress`). Der Empfaengerblock
   * (`buyer`) wird davon unabhaengig IMMER gedruckt — ohne ihn waere ein Lieferschein an
   * niemanden adressiert.
   */
  showDeliveryAddress: boolean;
  /** Standard-SHIPPING-CustomerAddress des Kunden, falls vorhanden (siehe showDeliveryAddress). */
  deliveryAddress?: DeliveryNotePdfShippingAddress | null;
  headerText?: string | null;
  footerText?: string | null;
  // Nummer des Quellbelegs (Angebot/Rechnung) — Aufloesung von sourceType/sourceId
  // kommt erst mit der Route (Task 5), hier nur durchgereicht.
  sourceNumber?: string | null;
}

function deDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function lineNetCents(line: DeliveryNotePdfLine): number {
  if (line.unitNetPriceCents == null) return 0;
  return Math.round((line.quantityMilli * line.unitNetPriceCents) / 1000);
}

interface Column {
  header: string;
  width: number;
  align?: "left" | "right";
  render: (line: DeliveryNotePdfLine) => string;
}

/** Spalten dynamisch je nach Flags — Artikelnr./Beschreibung/Preise/USt sind optional. */
function buildColumns(data: DeliveryNotePdfData): Column[] {
  const cur = data.currency;
  const columns: Column[] = [{ header: "Pos.", width: 28, render: (l) => String(l.pos) }];
  if (data.showArticleNumber) {
    columns.push({ header: "Art.-Nr.", width: 70, render: (l) => l.articleNumber ?? "" });
  }
  if (data.showDescription) {
    columns.push({ header: "Beschreibung", width: data.showArticleNumber ? 150 : 220, render: (l) => l.description });
  }
  columns.push({ header: "Menge", width: 70, align: "right", render: (l) => `${formatQuantity(l.quantityMilli)} ${l.unit}` });
  if (data.showPrices) {
    columns.push({
      header: "Einzel",
      width: 70,
      align: "right",
      render: (l) => (l.unitNetPriceCents != null ? formatCents(l.unitNetPriceCents, cur) : ""),
    });
    if (data.showTax) {
      columns.push({ header: "USt", width: 35, align: "right", render: (l) => (l.taxRate != null ? `${l.taxRate}%` : "") });
    }
    columns.push({ header: "Netto", width: 70, align: "right", render: (l) => (l.unitNetPriceCents != null ? formatCents(lineNetCents(l), cur) : "") });
  }
  return columns;
}

export function renderDeliveryNotePdf(data: DeliveryNotePdfData, theme: PdfTheme): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const margins = pdfMargins(theme);
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left },
      bufferPages: true,
      compress: theme.compress ?? true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(concatPdfChunks(chunks)));
    doc.on("error", reject);
    doc.on("pageAdded", () => drawBackground(doc, theme));
    drawBackground(doc, theme);

    const cur = data.currency;
    const left = margins.left;
    const right = doc.page.width - margins.right;
    const titleColor = theme.brand.primaryColor;

    // S2 (Fix-Welle, Final-Review): Summenblock aus `right` statt `left + 300` ableiten
    // (siehe invoice-pdf.ts) — sonst wandern die Betraege bei grossen Raendern aus dem
    // Inhaltsbereich heraus.
    const sumValueWidth = 70;
    const sumLabelWidth = 120;
    const sumColGap = 5;
    const sumValueX = right - sumValueWidth;
    const sumLabelX = sumValueX - sumColGap - sumLabelWidth;

    drawLogo(doc, theme, right, margins.top);

    // Kopf: Absender
    const senderFallback = `${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`;
    drawSenderLine(doc, theme, left, margins.top, senderFallback);

    // Empfänger — S7 (Fix-Welle): IMMER gedruckt, unabhaengig von showDeliveryAddress
    // (ein Lieferschein ohne Empfaengerblock waere an niemanden adressiert).
    const buyerY = margins.top + 60;
    doc.fillColor("#000").fontSize(11);
    doc.text(data.buyer.name, left, buyerY);
    if (data.buyer.contactName) doc.text(data.buyer.contactName);
    doc.text(data.buyer.addressLine1);
    if (data.buyer.addressLine2) doc.text(data.buyer.addressLine2);
    doc.text(`${data.buyer.postalCode} ${data.buyer.city}`);
    let leftColumnBottom = doc.y;

    // Lieferadresse — S7 (Fix-Welle, §36): zusaetzlicher Block aus der Standard-SHIPPING-
    // Adresse des Kunden, NUR wenn showDeliveryAddress an ist UND eine solche Adresse
    // existiert (ohne sie kein Block, kein leeres "Lieferadresse:").
    if (data.showDeliveryAddress && data.deliveryAddress) {
      const da = data.deliveryAddress;
      doc.fontSize(9).fillColor("#555").text("Lieferadresse:", left, doc.y + 8);
      doc.fontSize(11).fillColor("#000");
      doc.text(da.addressLine1);
      if (da.addressLine2) doc.text(da.addressLine2);
      doc.text(`${da.postalCode} ${da.city}`);
      leftColumnBottom = doc.y;
    }

    // Titel + Meta (rechts)
    doc.fontSize(18).fillColor(titleColor).text("Lieferschein", left, buyerY, { align: "right" });
    doc.fontSize(10).fillColor("#333");
    const metaTop = margins.top + 90;
    doc.text(`Lieferscheinnummer: ${data.number}`, left + 250, metaTop, { align: "right" });
    doc.text(`Datum: ${deDate(data.issueDate)}`, { align: "right" });
    if (data.deliveryDate) doc.text(`Lieferdatum: ${deDate(data.deliveryDate)}`, { align: "right" });
    if (data.shippingDate) doc.text(`Versanddatum: ${deDate(data.shippingDate)}`, { align: "right" });
    if (data.sourceNumber) doc.text(`Bezugsbeleg: ${data.sourceNumber}`, { align: "right" });
    const rightColumnBottom = doc.y;

    // Kopftext (Platzhalter bereits aufgeloest) — vor der Positions-Tabelle, y danach dynamisch.
    // y wird jetzt aus dem tatsaechlich gedruckten Empfaenger-/Lieferadress-/Meta-Block
    // abgeleitet statt fest auf margins.top+170 — der optionale Lieferadress-Block braucht
    // je nach Inhalt mehr oder weniger Platz.
    let y = Math.max(leftColumnBottom, rightColumnBottom, margins.top + 150) + 20;
    if (data.headerText) {
      doc.fontSize(9).fillColor("#333").text(data.headerText, left, y, { width: right - left });
      y = doc.y + 10;
    }

    // Positions-Tabelle
    const columns = buildColumns(data);
    doc.fontSize(9).fillColor("#fff");
    doc.rect(left, y, right - left, 18).fill("#1f2937");
    doc.fillColor("#fff");
    let x = left + 4;
    for (const col of columns) {
      doc.text(col.header, x, y + 5, { width: col.width, align: col.align ?? "left" });
      x += col.width + 8;
    }
    y += 22;

    doc.fillColor("#000").fontSize(9);
    for (const line of data.lines) {
      x = left + 4;
      for (const col of columns) {
        doc.text(col.render(line), x, y, { width: col.width, align: col.align ?? "left" });
        x += col.width + 8;
      }
      y += 16;
    }

    // Summen — nur mit Preisen (ohne showPrices gibt es keinen Wert, den man summieren koennte).
    if (data.showPrices) {
      y += 10;
      doc.moveTo(sumLabelX, y).lineTo(right, y).strokeColor(titleColor).stroke();
      y += 6;
      const sumRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        doc.text(label, sumLabelX, y, { width: sumLabelWidth, align: "right" });
        doc.text(value, sumValueX, y, { width: sumValueWidth, align: "right" });
        y += 16;
      };
      if (data.showTax) {
        const breakdown = computeTaxBreakdown(
          data.lines
            .filter((l) => l.unitNetPriceCents != null && l.taxRate != null)
            .map((l) => ({ lineNetCents: lineNetCents(l), taxRate: l.taxRate!, taxCategory: "S" })),
        );
        sumRow("Nettobetrag", formatCents(breakdown.netTotalCents, cur));
        for (const t of breakdown.breakdown) {
          if (t.taxCents > 0) sumRow(`zzgl. ${t.taxRate}% USt`, formatCents(t.taxCents, cur));
        }
        sumRow("Gesamtbetrag", formatCents(breakdown.grossTotalCents, cur), true);
      } else {
        const net = data.lines.reduce((sum, l) => sum + lineNetCents(l), 0);
        sumRow("Nettobetrag", formatCents(net, cur), true);
      }
      doc.font("Helvetica");
    }

    // Fusstext (Platzhalter bereits aufgeloest) — nach den Summen.
    if (data.footerText) {
      y += 10;
      doc.fontSize(9).fillColor("#333").text(data.footerText, left, y, { width: right - left });
    }

    // Fußzeile: Aussteller-Pflichtangaben (nur wenn options.showFooter an ist).
    const footY = doc.page.height - margins.bottom - 20;
    if (theme.options.showFooter) {
      // S3 (Fix-Welle): Branded-Footer ODER Fallback, nie beide (siehe invoice-pdf.ts).
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
      }
    }

    // Falz-/Lochmarken + Seitenzahlen.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (theme.options.foldMarks) drawFoldMarks(doc);
      if (theme.options.punchMarks) drawPunchMark(doc);
    }
    if (theme.options.showPageNumbers) drawPageNumbers(doc, theme);

    doc.end();
  });
}
