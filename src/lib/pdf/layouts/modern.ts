/** Layout "Modern" — Kopfbalken in Primaerfarbe ueber die volle Breite mit Logo/Firmenname in Weiss, Infoblock als Karte. */
import type { PdfLayout } from "./types";
import { drawRecipient, drawMetaTable, drawFooterColumns } from "./shared";
import { drawSenderLine } from "../layout";
import { mm } from "../marks";

// Hoehe des Kopfbalkens auf der ersten Seite (in drawKopf) bzw. auf Folgeseiten (in
// drawPageChrome, dort schmaler — nur der Balken, kein Titel/Logo).
const HEADER_BAR_H = 54;
const CHROME_BAR_H = 24;

export const modernLayout: PdfLayout = {
  id: "modern",
  name: "Modern",
  description: "Farbiger Kopfbalken mit Logo, Infoblock als Karte, Zebrastreifen in der Tabelle.",
  fontDelta: 0,
  drawKopf(frame, input) {
    const { doc, theme, left, right, margins, primary, base } = frame;
    const barH = HEADER_BAR_H;
    doc.rect(0, 0, doc.page.width, margins.top + barH).fill(primary);
    if (theme.logoBuffer) {
      const logoW = mm(theme.brand.logoWidthMm);
      const logoH = barH - mm(4);
      doc.image(theme.logoBuffer, left, (margins.top + barH - logoH) / 2, { fit: [logoW, logoH] });
    } else {
      doc.font("Helvetica-Bold").fontSize(base + 6).fillColor("#fff").text(input.senderFallback.split(" · ")[0] ?? "", left, margins.top + 16);
    }
    doc.font("Helvetica-Bold").fontSize(base + 8).fillColor("#fff").text(input.title, left, margins.top + 14, { width: right - left, align: "right" });
    const top = margins.top + barH + 18;
    drawSenderLine(doc, theme, left, top, input.senderFallback);
    const buyerY = top + 18;
    const cardX = right - 210;
    // Follow-up (Reviews, Task 5): Empfaengerblock nicht breiter als bis 10pt vor die
    // Infoblock-Karte — sonst laeuft ein langer Empfaengername in die Karte hinein.
    const recipientBottom = drawRecipient(frame, input, buyerY, base + 1, cardX - left - 10);
    const cardH = (input.meta.length + 1) * (base + 3) + 16;
    doc.roundedRect(cardX, buyerY - 8, 210, cardH, 4).fill("#f3f4f6");
    doc.fillColor("#000");
    const metaBottom = drawMetaTable(frame, [{ label: input.numberLabel, value: input.number }, ...input.meta], cardX + 8, buyerY, 194, base - 1);
    let y = Math.max(recipientBottom, metaBottom + 8, margins.top + 190) + 16;
    if (input.intro) {
      doc.font("Helvetica").fontSize(base).fillColor("#000").text(input.intro, left, y, { width: right - left });
      y = doc.y + 10;
    }
    return y;
  },
  table: { headerFill: "#f3f4f6", headerText: "#111", headerHeight: 18, rowRule: null, zebra: "#fafafa", boldTitle: true, textColor: "#000" },
  drawTotalsRule(frame, x, y) {
    frame.doc.moveTo(x, y).lineTo(frame.right, y).lineWidth(1.5).strokeColor(frame.primary).stroke().lineWidth(1);
  },
  drawFooter(frame, columns, y) {
    const { doc, primary } = frame;
    doc.rect(0, y - 8, doc.page.width, doc.page.height - y + 8).fill("#f3f4f6");
    doc.moveTo(frame.left, y - 8).lineTo(frame.right, y - 8).lineWidth(1).strokeColor(primary).stroke();
    drawFooterColumns(frame, columns, y, 7.5, "#333333");
  },
  footerHeight: 44,
  // Nur der Balken (kein Logo/Titel) auf Folgeseiten — der volle Kopf steht bereits auf
  // Seite 1 (drawKopf). Rueckgabe = neue Start-y fuer den Seiteninhalt (statt margins.top).
  drawPageChrome(frame) {
    const { doc, primary, margins } = frame;
    doc.rect(0, 0, doc.page.width, margins.top + CHROME_BAR_H).fill(primary);
    return margins.top + 30;
  },
};
