/** PDF eines Lieferscheins. Layout an invoice-pdf.ts angelehnt. */
import PDFDocument from "pdfkit";
import { formatCents, formatQuantity } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";

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

export function renderDeliveryNotePdf(data: DeliveryNotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cur = data.currency;
    const left = 50;
    const right = 545;

    // Kopf: Absender
    doc.fontSize(9).fillColor("#555");
    doc.text(`${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`, left, 50);

    // Empfänger
    doc.fillColor("#000").fontSize(11);
    doc.text(data.buyer.name, left, 110);
    if (data.buyer.contactName) doc.text(data.buyer.contactName);
    doc.text(data.buyer.addressLine1);
    if (data.buyer.addressLine2) doc.text(data.buyer.addressLine2);
    doc.text(`${data.buyer.postalCode} ${data.buyer.city}`);

    // Titel + Meta (rechts)
    doc.fontSize(18).fillColor("#111").text("Lieferschein", left, 110, { align: "right" });
    doc.fontSize(10).fillColor("#333");
    doc.text(`Lieferscheinnummer: ${data.number}`, 300, 140, { align: "right" });
    doc.text(`Datum: ${deDate(data.issueDate)}`, { align: "right" });
    if (data.deliveryDate) doc.text(`Lieferdatum: ${deDate(data.deliveryDate)}`, { align: "right" });
    if (data.shippingDate) doc.text(`Versanddatum: ${deDate(data.shippingDate)}`, { align: "right" });
    if (data.sourceNumber) doc.text(`Bezugsbeleg: ${data.sourceNumber}`, { align: "right" });

    // Kopftext (Platzhalter bereits aufgeloest) — vor der Positions-Tabelle, y danach dynamisch.
    let y = 220;
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
      doc.moveTo(left + 300, y).lineTo(right, y).strokeColor("#ccc").stroke();
      y += 6;
      const sumRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        doc.text(label, left + 300, y, { width: 120, align: "right" });
        doc.text(value, left + 425, y, { width: 70, align: "right" });
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

    // Fußzeile: Aussteller-Pflichtangaben
    const footY = 760;
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

    doc.end();
  });
}
