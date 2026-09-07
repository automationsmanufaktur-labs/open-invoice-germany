/**
 * PDF einer Mahnung / Zahlungserinnerung.
 * Phase 7, Task 3 (§35-§36): Briefpapier + Druckoptionen kommen aus einem `PdfTheme`.
 */
import PDFDocument from "pdfkit";
import { formatCents } from "@/lib/money";
import { DUNNING_LEVEL_TITLE } from "@/lib/dunning";
import type { PdfTheme } from "./theme";
import { drawFoldMarks, drawPunchMark, drawPageNumbers, concatPdfChunks } from "./marks";
import { pdfMargins, drawBackground, drawLogo, drawSenderLine, drawBrandedFooter } from "./layout";

export interface DunningPdfData {
  number: string;
  level: number;
  /** Name der Mahnstufe (Phase 6) — Titel im PDF, Fallback DUNNING_LEVEL_TITLE[level]. */
  stageName?: string | null;
  sentDate: Date;
  newDueDate: Date;
  currency: string;
  seller: {
    name: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    taxNumber?: string | null;
    vatId?: string | null;
    iban?: string | null;
    bic?: string | null;
    bankName?: string | null;
  };
  buyer: {
    name: string;
    contactName?: string | null;
    addressLine1: string;
    addressLine2?: string | null;
    postalCode: string;
    city: string;
  };
  invoiceNumber: string;
  invoiceDate: Date;
  openAmountCents: number;
  interestCents: number;
  flatFee40Cents: number;
  /** Mahnkosten der Stufe (Phase 6, `DunningStage.feeCents`, nur order >= 2). */
  feeCents: number;
  lateFeeCents: number;
  totalCents: number;
  daysOverdue: number;
}

function deDate(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

const INTRO: Record<number, (n: string) => string> = {
  0: (n) => `bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die Rechnung ${n} bislang nicht ausgeglichen wurde. Vermutlich ist Ihnen dies entgangen — wir bitten höflich um Begleichung.`,
  1: (n) => `trotz Fälligkeit ist die Rechnung ${n} bis heute nicht beglichen. Wir fordern Sie auf, den offenen Betrag zuzüglich der entstandenen Verzugskosten bis zum unten genannten Datum zu zahlen.`,
  2: (n) => `auch nach unserer ersten Mahnung ist die Rechnung ${n} weiterhin offen. Wir setzen Ihnen letztmalig eine Frist zur Zahlung, bevor wir weitere Schritte einleiten.`,
};

export function renderDunningPdf(data: DunningPdfData, theme: PdfTheme): Promise<Buffer> {
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
    const title = data.stageName || DUNNING_LEVEL_TITLE[data.level] || `${data.level}. Mahnung`;

    drawLogo(doc, theme, right, margins.top);

    const senderFallback = `${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`;
    drawSenderLine(doc, theme, left, margins.top, senderFallback);

    const buyerY = margins.top + 60;
    doc.fillColor("#000").fontSize(11);
    doc.text(data.buyer.name, left, buyerY);
    if (data.buyer.contactName) doc.text(data.buyer.contactName);
    doc.text(data.buyer.addressLine1);
    if (data.buyer.addressLine2) doc.text(data.buyer.addressLine2);
    doc.text(`${data.buyer.postalCode} ${data.buyer.city}`);

    doc.fontSize(18).fillColor(titleColor).text(title, left, buyerY, { align: "right" });
    doc.fontSize(10).fillColor("#333");
    const metaTop = margins.top + 90;
    doc.text(`Nr.: ${data.number}`, left + 250, metaTop, { align: "right" });
    doc.text(`Datum: ${deDate(data.sentDate)}`, { align: "right" });

    const introY = margins.top + 150;
    doc.fontSize(11).fillColor("#000").text("Sehr geehrte Damen und Herren,", left, introY);
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#333").text((INTRO[data.level] ?? INTRO[2])(data.invoiceNumber), { width: right - left });

    // Aufstellung
    let y = margins.top + 240;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#000");
      doc.text(label, left, y, { width: 360 });
      doc.text(value, left + 360, y, { width: right - left - 360, align: "right" });
      y += 16;
    };
    row(`Rechnung ${data.invoiceNumber} vom ${deDate(data.invoiceDate)} — offener Betrag`, formatCents(data.openAmountCents, cur));
    if (data.interestCents > 0) row(`Verzugszinsen (${data.daysOverdue} Tage)`, formatCents(data.interestCents, cur));
    if (data.flatFee40Cents > 0) row("Verzugspauschale (§ 288 Abs. 5 BGB)", formatCents(data.flatFee40Cents, cur));
    if (data.feeCents > 0) row("Mahnkosten", formatCents(data.feeCents, cur));
    if (data.lateFeeCents > 0) row("Sonstige Auslagen", formatCents(data.lateFeeCents, cur));
    y += 4;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(titleColor).stroke();
    y += 6;
    row("Zahlbarer Gesamtbetrag", formatCents(data.totalCents, cur), true);
    doc.font("Helvetica");

    y += 16;
    doc.fontSize(10).fillColor("#000").text(`Bitte überweisen Sie den Gesamtbetrag bis spätestens ${deDate(data.newDueDate)}.`, left, y, { width: right - left });

    // Fuß: Bank + Aussteller (nur wenn options.showFooter an ist).
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
        const bankLine = [
          data.seller.bankName ? `Bank: ${data.seller.bankName}` : null,
          data.seller.iban ? `IBAN: ${data.seller.iban}` : null,
          data.seller.bic ? `BIC: ${data.seller.bic}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        if (bankLine) doc.text(bankLine, left, footY + 11, { width: right - left, align: "center" });
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
