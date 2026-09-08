/**
 * PDF eines Lieferscheins. Layout an invoice-pdf.ts angelehnt.
 * Phase 7, Task 3 (§35-§36): Briefpapier + Druckoptionen kommen aus einem `PdfTheme`.
 *
 * Phase 11b, Task 3 — Kopf/Tabellenkopf/Summenlinie/Fusszeile kommen jetzt aus einem
 * `PdfLayout` (siehe invoice-pdf.ts), statt aus einer eigenen, fast identischen Kopie der
 * Zeichenlogik. Neu (Nachtrag aus der Erhebung): `ensureSpace`-Paginierungsschutz je
 * Positionszeile (vorher konnte pdfkit bei vielen Positionen unkontrolliert mitten in
 * einer Zeile umbrechen).
 */
import PDFDocument from "pdfkit";
import { formatCents, formatQuantity } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import type { PdfTheme } from "./theme";
import { drawFoldMarks, drawPunchMark, drawPageNumbers, drawWatermark, concatPdfChunks } from "./marks";
import { pdfMargins, drawBackground } from "./layout";
import { getLayout } from "./layouts/registry";
import { drawTableHeaderRow, type TableHeaderColumn } from "./layouts/shared";
import type { LayoutFrame, KopfMetaRow } from "./layouts/types";
import { buildFooterColumns } from "./footer";

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

const COLUMN_GAP = 8;

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
    // Der `pageAdded`-Handler selbst wird weiter unten registriert (siehe `chromeStartY`),
    // sobald `frame`/`layout` feststehen — die erste (automatisch von pdfkit angelegte)
    // Seite bekommt den Hintergrund hier dennoch manuell, da `pageAdded` fuer sie nicht feuert.
    drawBackground(doc, theme);

    const cur = data.currency;
    const left = margins.left;
    const right = doc.page.width - margins.right;

    // S2 (Fix-Welle, Final-Review): Summenblock aus `right` statt `left + 300` ableiten
    // (siehe invoice-pdf.ts) — sonst wandern die Betraege bei grossen Raendern aus dem
    // Inhaltsbereich heraus.
    const sumValueWidth = 70;
    const sumLabelWidth = 120;
    const sumColGap = 5;
    const sumValueX = right - sumValueWidth;
    const sumLabelX = sumValueX - sumColGap - sumLabelWidth;

    // Phase 11b — Layout-Hooks (Kopf/Tabellenstil/Summenlinie/Fusszeile) statt eigener
    // Kopie der Zeichenlogik; `standard` reproduziert das bisherige Layout.
    const layout = getLayout(theme.layoutId);
    const base = theme.brand.fontSizePt + layout.fontDelta;
    const frame: LayoutFrame = { doc, theme, margins, left, right, width: right - left, primary: theme.brand.primaryColor, base };
    // Fix-Runde 1 (Task-5-Review, Minor): dieselbe `rowH`-Formel wie invoice-pdf.ts —
    // die Positionszeilen hatten weiterhin fest 16pt, unabhaengig von `layout.fontDelta`
    // (z. B. `kompakt`). Bei `base = 10` (Default) unveraendert 16.
    const rowH = Math.round((base - 1) * 1.8);

    // Fix-Welle (Abschluss-Review, Block 3 "Minor" — `modern`-Chrome inkonsistent): siehe
    // invoice-pdf.ts fuer die ausfuehrliche Begruendung. `chromeStartY` wird vom
    // `pageAdded`-Handler gesetzt (fuer JEDEN `doc.addPage()`, manuell wie pdfkit-eigen)
    // und von `ensureSpace`/`ensurePlainSpace` unten nur noch GELESEN.
    let chromeStartY: number | undefined;
    doc.on("pageAdded", () => {
      drawBackground(doc, theme);
      const chromeResult = layout.drawPageChrome?.(frame);
      chromeStartY = typeof chromeResult === "number" ? chromeResult : undefined;
    });

    const meta: KopfMetaRow[] = [{ label: "Datum", value: deDate(data.issueDate) }];
    if (data.deliveryDate) meta.push({ label: "Lieferdatum", value: deDate(data.deliveryDate) });
    if (data.shippingDate) meta.push({ label: "Versanddatum", value: deDate(data.shippingDate) });
    if (data.sourceNumber) meta.push({ label: "Bezugsbeleg", value: data.sourceNumber });

    // Lieferadresse — S7 (Fix-Welle, §36): zusaetzlicher Block aus der Standard-SHIPPING-
    // Adresse des Kunden, NUR wenn showDeliveryAddress an ist UND eine solche Adresse
    // existiert (ohne sie kein Block, kein leeres "Lieferadresse:"). Der Empfaengerblock
    // (`recipient`) wird davon unabhaengig IMMER gedruckt (siehe `KopfInput`).
    const da = data.showDeliveryAddress ? data.deliveryAddress : null;
    let y = layout.drawKopf(frame, {
      title: "Lieferschein",
      numberLabel: "Lieferscheinnummer",
      number: data.number,
      meta,
      recipient: data.buyer,
      extraRecipientBlock: da ? { heading: "Lieferadresse:", lines: [da.addressLine1, ...(da.addressLine2 ? [da.addressLine2] : []), `${da.postalCode} ${da.city}`] } : undefined,
      senderFallback: `${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`,
      intro: data.headerText,
    });

    // Positions-Tabelle
    const columns = buildColumns(data);
    const tableX = left + 4;
    // Fix-Runde 2 (Koordinator, Critical): seit Fix-Runde 1 (Punkt 6) zeichnet
    // `layout.drawFooter` die Fusszeile auf JEDER Seite — `pageBottom` reservierte diesen
    // Bereich bisher NICHT, sodass Positions-/Summenzeilen in das Fusszeilen-Band
    // hineinragen konnten (verifiziert: 75 Positionen ueberlappten auf Seite 1). Bei
    // aktiver Fusszeile reserviert `pageBottom` jetzt zusaetzlich `layout.footerHeight`
    // plus 6pt Sicherheitsabstand; `footY` selbst bleibt unveraendert.
    const pageBottom = theme.options.showFooter ? doc.page.height - margins.bottom - layout.footerHeight - 6 : doc.page.height - margins.bottom;

    const drawTableHeader = (atY: number): number => {
      let cursor = 0;
      const headerColumns: TableHeaderColumn[] = columns.map((col) => {
        const x = tableX + cursor;
        cursor += col.width + COLUMN_GAP;
        return { header: col.header, x, width: col.width, align: col.align };
      });
      return drawTableHeaderRow(frame, layout, headerColumns, atY, data.showDescription);
    };

    // Nachtrag (Erhebung): bisher ohne Paginierungsschutz je Zeile — dieselbe Logik wie
    // in invoice-pdf.ts (VOR jeder Zeile pruefen und bei Bedarf explizit umbrechen).
    const ensureSpace = (atY: number, needed: number): number => {
      if (atY + needed <= pageBottom) return atY;
      doc.addPage();
      // Phase 11b, Task 4 — Kopf-"Chrome" auf Folgeseiten (z. B. der Balken von `modern`).
      // Fix-Welle: `chromeStartY` kommt vom `pageAdded`-Handler (siehe oben) — hier NICHT
      // mehr selbst `drawPageChrome` aufrufen (sonst Doppel-Zeichnung).
      return drawTableHeader(typeof chromeStartY === "number" ? chromeStartY : margins.top);
    };

    // Fix-Runde 1 (Koordinator, Punkt 2): der Summenblock braucht KEINEN Tabellenkopf mehr
    // (kein Item-Tabellenkontext) — `ensureSpace` (das bei jedem Seitenumbruch den Kopf neu
    // zeichnet) ist dafuer der falsche Helfer; `ensurePlainSpace` bricht nur um, ohne den
    // Tabellenkopf zu wiederholen (identisch zum Pendant in invoice-pdf.ts).
    const ensurePlainSpace = (atY: number, needed: number): number => {
      if (atY + needed <= pageBottom) return atY;
      doc.addPage();
      return typeof chromeStartY === "number" ? chromeStartY : margins.top;
    };

    y = drawTableHeader(y);

    doc.fillColor("#000").fontSize(base - 1);
    for (const line of data.lines) {
      y = ensureSpace(y, rowH);
      let x = tableX;
      for (const col of columns) {
        doc.text(col.render(line), x, y, { width: col.width, align: col.align ?? "left" });
        x += col.width + COLUMN_GAP;
      }
      y += rowH;
    }

    // Summen — nur mit Preisen (ohne showPrices gibt es keinen Wert, den man summieren koennte).
    if (data.showPrices) {
      y = ensurePlainSpace(y, 40);
      y += 10;
      layout.drawTotalsRule(frame, sumLabelX, y);
      y += 6;
      const sumRow = (label: string, value: string, bold = false) => {
        y = ensurePlainSpace(y, 16);
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(base);
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
    // Fix-Runde 2 (Koordinator, Guard a): `ensurePlainSpace` VOR dem Text, damit ein
    // knapp vor dem (jetzt fusszeilen-reservierten) Seitenende endender Summenblock den
    // Fusstext nicht ins Fusszeilen-Band schreibt.
    if (data.footerText) {
      y = ensurePlainSpace(y, 30);
      y += 10;
      doc.fontSize(base - 1).fillColor("#333").text(data.footerText, left, y, { width: right - left });
    }

    // Fix-Runde 1 (Koordinator, Punkt 6): Fusszeile auf JEDER Seite — `layout.drawFooter`
    // wandert in die Seiten-Schleife (vorher nur auf der zuletzt angelegten Seite).
    const footY = doc.page.height - margins.bottom - layout.footerHeight;
    const footerColumns = buildFooterColumns(
      { seller: data.seller, iban: data.seller.iban, bic: data.seller.bic, bankName: data.seller.bankName, ...theme.footerFacts },
      theme.brand,
    );

    // Falz-/Lochmarken + Seitenzahlen + Fusszeile.
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
  });
}
