/** PDF einer Mahnung / Zahlungserinnerung. */
import PDFDocument from "pdfkit";
import { formatCents } from "@/lib/money";
import { DUNNING_LEVEL_TITLE } from "@/lib/dunning";

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

export function renderDunningPdf(data: DunningPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cur = data.currency;
    const left = 50;
    const right = 545;
    const title = data.stageName || DUNNING_LEVEL_TITLE[data.level] || `${data.level}. Mahnung`;

    doc.fontSize(9).fillColor("#555");
    doc.text(`${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`, left, 50);

    doc.fillColor("#000").fontSize(11);
    doc.text(data.buyer.name, left, 110);
    if (data.buyer.contactName) doc.text(data.buyer.contactName);
    doc.text(data.buyer.addressLine1);
    if (data.buyer.addressLine2) doc.text(data.buyer.addressLine2);
    doc.text(`${data.buyer.postalCode} ${data.buyer.city}`);

    doc.fontSize(18).fillColor("#111").text(title, left, 110, { align: "right" });
    doc.fontSize(10).fillColor("#333");
    doc.text(`Nr.: ${data.number}`, 300, 140, { align: "right" });
    doc.text(`Datum: ${deDate(data.sentDate)}`, { align: "right" });

    doc.fontSize(11).fillColor("#000").text("Sehr geehrte Damen und Herren,", left, 200);
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#333").text((INTRO[data.level] ?? INTRO[2])(data.invoiceNumber), { width: right - left });

    // Aufstellung
    let y = 290;
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
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#ccc").stroke();
    y += 6;
    row("Zahlbarer Gesamtbetrag", formatCents(data.totalCents, cur), true);
    doc.font("Helvetica");

    y += 16;
    doc.fontSize(10).fillColor("#000").text(`Bitte überweisen Sie den Gesamtbetrag bis spätestens ${deDate(data.newDueDate)}.`, left, y, { width: right - left });

    // Fuß: Bank + Aussteller
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
    const bankLine = [
      data.seller.bankName ? `Bank: ${data.seller.bankName}` : null,
      data.seller.iban ? `IBAN: ${data.seller.iban}` : null,
      data.seller.bic ? `BIC: ${data.seller.bic}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (bankLine) doc.text(bankLine, left, footY + 11, { width: right - left, align: "center" });

    doc.end();
  });
}
