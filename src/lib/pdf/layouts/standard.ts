/** Layout "Standard" — exakt das Layout von Phase 7 (Kompatibilitaet fuer Bestandsbetreiber). */
import type { PdfLayout } from "./types";
import { drawLogoAndSender, drawRecipient, drawMetaRows, drawFooterColumns } from "./shared";

export const standardLayout: PdfLayout = {
  id: "standard",
  name: "Standard",
  description: "Dunkler Tabellenkopf, Titel in Primärfarbe, dreispaltige Fußzeile.",
  fontDelta: 0,
  drawKopf(frame, input) {
    const { doc, left, right, margins, primary } = frame;
    drawLogoAndSender(frame, input);
    const buyerY = margins.top + 60;
    // Fix-Runde 1 (Task-5-Review): Empfaengerbreite explizit auf den festen 240pt-Default
    // gepinnt (Infoblock steht bei `left + 250`) — nicht auf `drawRecipient`s Default
    // verlassen, siehe shared.ts#drawRecipient.
    const recipientBottom = drawRecipient(frame, input, buyerY, 11, 240);
    doc.fontSize(18).fillColor(primary).font("Helvetica").text(input.title, left, buyerY, { align: "right", width: right - left });
    const metaTop = margins.top + 90;
    const metaBottom = drawMetaRows(frame, [{ label: input.numberLabel, value: input.number }, ...input.meta], left + 250, metaTop);
    // Phase 11b, Task 3 — mit einem zusaetzlichen Empfaengerblock (Lieferschein-
    // Lieferadresse, S7 Fix-Welle) haengt der Tabellenbeginn vom tatsaechlich gedruckten
    // Empfaenger-/Meta-Block ab (der Lieferadress-Block braucht je nach Inhalt mehr oder
    // weniger Platz als die feste Rechnungs-Kopfhoehe); ohne ihn bleibt die feste Hoehe aus
    // Task 2 (byte-kompatibel zu Phase 7).
    let y = input.extraRecipientBlock ? Math.max(recipientBottom, metaBottom, margins.top + 150) + 20 : margins.top + 170;
    if (input.intro) {
      doc.fontSize(9).fillColor("#333").text(input.intro, left, y, { width: right - left });
      y = doc.y + 10;
    }
    return y;
  },
  table: { headerFill: "#1f2937", headerText: "#fff", headerHeight: 18, rowRule: null, zebra: null, boldTitle: false, textColor: "#000" },
  drawTotalsRule(frame, x, y) {
    frame.doc.moveTo(x, y).lineTo(frame.right, y).strokeColor(frame.primary).stroke();
  },
  drawFooter(frame, columns, y) {
    // Phase 7: drei Spalten (links/mitte/rechts) — bei AUTO-Fusszeile werden vier Spalten
    // gleichmaessig verteilt; Text grau 8pt wie bisher.
    drawFooterColumns(frame, columns, y, 8, "#666666");
  },
  // Phase 11b, Task 3 — vorher 32pt (reichte fuer die zweizeilige Phase-7-Fusszeile).
  // Die vierspaltige AUTO-Fusszeile traegt bis zu drei Zeilen JE Spalte bei einer bei
  // vier Spalten entsprechend schmaleren Spaltenbreite; einzelne Zeilen (z. B. die
  // gruppierte IBAN oder eine laengere E-Mail-Adresse) brechen dadurch innerhalb der
  // Spalte um. 46pt bietet Reserve fuer eine umgebrochene Zeile, ohne dass pdfkit den
  // eigenen (durch dieselben `margins.bottom` gesetzten) Seitenumbruch-Schwellenwert
  // ueberschreitet — sonst haengt eine ueberlaufende Fusszeile eine leere Folgeseite an.
  footerHeight: 46,
};
