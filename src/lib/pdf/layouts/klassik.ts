/** Layout "Klassik" — Logo links oben, Firmenname rechts, Doppellinie unter dem Kopf, graue Fusszeile mit Linie. */
import type { PdfLayout } from "./types";
import { drawRecipient, drawMetaRows, drawFooterColumns } from "./shared";
import { drawSenderLine, LOGO_MAX_HEIGHT_MM } from "../layout";
import { mm } from "../marks";

export const klassikLayout: PdfLayout = {
  id: "klassik",
  name: "Klassik",
  description: "Logo links, Firmenname rechts, Doppellinie unter dem Kopf, dezente graue Fußzeile.",
  fontDelta: 0,
  drawKopf(frame, input) {
    const { doc, theme, left, right, margins, primary, base } = frame;
    if (theme.logoBuffer) doc.image(theme.logoBuffer, left, margins.top, { fit: [mm(theme.brand.logoWidthMm), mm(LOGO_MAX_HEIGHT_MM)] });
    doc.font("Helvetica-Bold").fontSize(base + 4).fillColor(primary).text(input.senderFallback.split(" · ")[0] ?? "", left, margins.top, { width: right - left, align: "right" });
    const ruleY = margins.top + 42;
    doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(1.2).strokeColor(primary).stroke();
    doc.moveTo(left, ruleY + 3).lineTo(right, ruleY + 3).lineWidth(0.4).strokeColor(primary).stroke().lineWidth(1);
    drawSenderLine(doc, theme, left, ruleY + 12, input.senderFallback);
    const buyerY = ruleY + 30;
    // Fix-Runde 1 (Task-5-Review): Empfaengerbreite explizit auf den festen 240pt-Default
    // gepinnt (Infoblock steht bei `left + 250`) — nicht auf `drawRecipient`s Default
    // verlassen, siehe shared.ts#drawRecipient.
    const recipientBottom = drawRecipient(frame, input, buyerY, base + 1, 240);
    doc.font("Helvetica-Bold").fontSize(base + 6).fillColor("#000").text(input.title, left + 250, buyerY, { width: right - left - 250, align: "right" });
    const metaBottom = drawMetaRows(frame, [{ label: input.numberLabel, value: input.number }, ...input.meta], left + 250, buyerY + base + 14, base, "#333");
    let y = Math.max(recipientBottom, metaBottom, margins.top + 160) + 20;
    if (input.intro) {
      doc.font("Helvetica").fontSize(base).fillColor("#000").text(input.intro, left, y, { width: right - left });
      y = doc.y + 10;
    }
    return y;
  },
  table: { headerFill: null, headerText: "#000", headerHeight: 18, rowRule: "#cccccc", zebra: null, boldTitle: false, textColor: "#000" },
  drawTotalsRule(frame, x, y) {
    frame.doc.moveTo(x, y).lineTo(frame.right, y).strokeColor("#000").stroke();
  },
  drawFooter(frame, columns, y) {
    frame.doc.moveTo(frame.left, y - 6).lineTo(frame.right, y - 6).lineWidth(0.4).strokeColor("#999999").stroke().lineWidth(1);
    drawFooterColumns(frame, columns, y, 7.5, "#555555");
  },
  footerHeight: 40,
};
