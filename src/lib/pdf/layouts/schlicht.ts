/**
 * Layout "Schlicht" — nach den Beispielbelegen des Betreibers: Logo rechts oben,
 * kleine Absenderzeile, Infoblock rechts als zweispaltige Tabelle (Nummer gross kursiv),
 * Titel fett-kursiv, Tabellenkopf nur kursiv mit Linie, fette Positionstitel, vierspaltige
 * Fusszeile in Primaerfarbe.
 */
import type { PdfLayout } from "./types";
import { drawLogoAndSender, drawRecipient, drawMetaTable, drawFooterColumns } from "./shared";

export const schlichtLayout: PdfLayout = {
  id: "schlicht",
  name: "Schlicht",
  description: "Ruhig und klar: Infoblock rechts, kursive Tabellenköpfe, fette Positionstitel, farbige vierspaltige Fußzeile.",
  fontDelta: 0,
  drawKopf(frame, input) {
    const { doc, left, right, margins, base } = frame;
    drawLogoAndSender(frame, input);
    const buyerY = margins.top + 62;

    // Infoblock rechts (Breite 200): kleine Beschriftung, darunter die Nummer gross
    // kursiv, darunter Label/Wert-Zeilen. Beide oberen Zeilen bekommen die VOLLE
    // Blockbreite statt einer festen Haelfte — pdfkit (dieses Bundle) ignoriert
    // `lineBreak: false`, sobald `width` gesetzt ist (der Zeilenumbruch laeuft in
    // dem Fall unabhaengig davon), ein enges Halbfeld fuer lange Labels wie
    // "Lieferscheinnummer" wuerde also trotzdem zweizeilig umbrechen und mit der
    // Meta-Tabelle darunter kollidieren.
    const infoX = right - 200;
    // Follow-up (Reviews, Task 5): Empfaengerblock nicht breiter als bis 10pt vor den
    // Infoblock — sonst laeuft ein langer Empfaengername in die Meta-Tabelle hinein.
    const recipientBottom = drawRecipient(frame, input, buyerY, base + 1, infoX - left - 10);
    doc.font("Helvetica").fontSize(base - 1).fillColor("#555");
    doc.text(input.numberLabel, infoX, buyerY - 14, { width: 200, align: "right" });
    doc.font("Helvetica-Oblique").fontSize(base + 3).fillColor("#000");
    doc.text(input.number, infoX, buyerY - 3, { width: 200, align: "right" });
    const metaBottom = drawMetaTable(frame, input.meta, infoX, buyerY + base + 8, 200, base - 1);

    let y = Math.max(recipientBottom, metaBottom, margins.top + 150) + 26;
    doc.font("Helvetica-BoldOblique").fontSize(base + 4).fillColor("#000").text(`${input.title} ${input.number}`, left, y, { width: right - left });
    y = doc.y + 12;
    if (input.intro) {
      doc.font("Helvetica").fontSize(base).fillColor("#000").text(input.intro, left, y, { width: right - left });
      y = doc.y + 12;
    }
    return y;
  },
  table: { headerFill: null, headerText: "#333", headerHeight: 16, rowRule: "#dddddd", zebra: null, boldTitle: true, textColor: "#000" },
  // Fix-Welle (Abschluss-Review, Block 3 — Referenzbeleg RE-41362): die Summenlinie spannt
  // jetzt die VOLLE Inhaltsbreite (`frame.left`…`frame.right`) statt nur die Summenspalten
  // (der uebergebene `x` ist `sumLabelX`, siehe invoice-pdf.ts) — Referenz zieht die Linie
  // ueber die gesamte Seitenbreite.
  drawTotalsRule(frame, _x, y) {
    frame.doc.moveTo(frame.left, y).lineTo(frame.right, y).lineWidth(0.5).strokeColor("#999999").stroke().lineWidth(1);
  },
  drawFooter(frame, columns, y) {
    drawFooterColumns(frame, columns, y, 7.5, frame.primary);
  },
  footerHeight: 44,
  // Fix-Welle: GiroCode links unter dem Summenblock (Referenz RE-41362) statt rechts
  // oberhalb der Fusszeile.
  giroPlacement: "below-totals",
  labels: {
    colEinzel: "Einzelpreis",
    colNetto: "Gesamtpreis",
    colPosSuffix: ".",
    net: "Gesamtbetrag netto",
    taxRow: (rate) => `zzgl. Umsatzsteuer ${rate}%`,
    gross: "Gesamtbetrag brutto",
    giroCaption: "GiroCode",
  },
};
