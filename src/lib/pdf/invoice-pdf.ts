/**
 * Erzeugt ein PDF einer Rechnung ("sonstige Rechnung" i.S.d. § 14 UStG).
 * Layout enthält alle Pflichtangaben; für B2B-E-Rechnungen ist zusätzlich der
 * XRechnung-/ZUGFeRD-Export maßgeblich (XML ist führend).
 */
import PDFDocument from "pdfkit";
import { formatCents, formatQuantity } from "@/lib/money";
import { parseRichText, renderRichTextPdf } from "@/lib/richtext";
import { computeSubtotals } from "@/domain/document/lines";
import type { EInvoiceData, EInvoiceLine } from "@/lib/einvoice/types";

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

function deDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function renderInvoicePdf(data: EInvoiceData): Promise<Buffer> {
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
    doc.text(
      `${data.seller.name} · ${data.seller.addressLine1} · ${data.seller.postalCode} ${data.seller.city}`,
      left,
      50,
    );

    // Empfänger
    doc.fillColor("#000").fontSize(11);
    doc.text(data.buyer.name, left, 110);
    if (data.buyer.contactName) doc.text(data.buyer.contactName);
    doc.text(data.buyer.addressLine1);
    if (data.buyer.addressLine2) doc.text(data.buyer.addressLine2);
    doc.text(`${data.buyer.postalCode} ${data.buyer.city}`);

    // Titel + Meta (rechts)
    doc.fontSize(18).fillColor("#111").text(TYPE_TITLE[data.type] ?? "Rechnung", left, 110, { align: "right" });
    doc.fontSize(10).fillColor("#333");
    const metaTop = 140;
    doc.text(`${NUMBER_LABEL[data.type] ?? "Nummer"}: ${data.number}`, 300, metaTop, { align: "right" });
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
    let y = 220;
    if (data.headerText) {
      doc.fontSize(9).fillColor("#333").text(data.headerText, left, y, { width: right - left });
      y = doc.y + 10;
    }

    // Positions-Tabelle. Phase 4b: Artikelnummer-Spalte nur, wenn irgendeine ITEM-Zeile
    // eine Artikelnummer trägt (§ Task 4 Facts); Beschreibung schrumpft entsprechend.
    const showArticleNumber = data.lines.some((l) => lineType(l) === "ITEM" && l.articleNumber);
    const descX = showArticleNumber ? left + 91 : left + 36;
    const descWidth = showArticleNumber ? 165 : 220;

    doc.fontSize(9).fillColor("#fff");
    doc.rect(left, y, right - left, 18).fill("#1f2937");
    doc.fillColor("#fff");
    doc.text("Pos.", left + 4, y + 5, { width: 28 });
    if (showArticleNumber) doc.text("Art.-Nr.", left + 36, y + 5, { width: 55 });
    doc.text("Beschreibung", descX, y + 5, { width: descWidth });
    doc.text("Menge", left + 256, y + 5, { width: 50, align: "right" });
    doc.text("Einzel", left + 312, y + 5, { width: 70, align: "right" });
    doc.text("USt", left + 386, y + 5, { width: 35, align: "right" });
    doc.text("Netto", left + 425, y + 5, { width: 70, align: "right" });
    y += 22;

    // Phase 4b (§8): Zwischensummen (SUBTOTAL) rechnen sich ausschließlich aus den
    // ITEM-Nettobeträgen seit der letzten HEADING/SUBTOTAL-Zeile (computeSubtotals).
    const subtotals = computeSubtotals(data.lines.map((l) => ({ lineType: lineType(l), lineNetCents: l.lineNetCents })));

    doc.fillColor("#000").fontSize(9);
    let itemPos = 0;
    data.lines.forEach((line, i) => {
      const type = lineType(line);

      if (type === "HEADING") {
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
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
        doc.text(line.description, left + 300, y, { width: 120, align: "right" });
        doc.text(formatCents(subtotals[i] ?? 0, cur), left + 425, y, { width: 70, align: "right" });
        doc.font("Helvetica").fontSize(9);
        y += 16;
        return;
      }

      // ITEM
      itemPos += 1;
      const h = 16;
      doc.text(String(itemPos), left + 4, y, { width: 28 });
      if (showArticleNumber) doc.text(line.articleNumber ?? "", left + 36, y, { width: 55 });
      doc.text(line.description, descX, y, { width: descWidth });
      doc.text(`${formatQuantity(line.quantityMilli)} ${line.unit}`, left + 256, y, { width: 50, align: "right" });
      doc.text(formatCents(line.unitNetPriceCents, cur), left + 312, y, { width: 70, align: "right" });
      doc.text(`${line.taxRate}%`, left + 386, y, { width: 35, align: "right" });
      doc.text(formatCents(line.lineNetCents, cur), left + 425, y, { width: 70, align: "right" });
      y += h;
      // Rabattzeile unter der Position (BG-27), z. B. "abzgl. 10 % Rabatt −12,00 €".
      if (line.discountCents) {
        const pct = line.discountPermille ? ` ${(line.discountPermille / 10).toFixed(2).replace(/\.00$/, "")} %` : "";
        doc.fontSize(8).fillColor("#555");
        doc.text(`abzgl.${pct} Rabatt`, descX, y, { width: descWidth });
        doc.text(`−${formatCents(Math.abs(line.discountCents), cur)}`, left + 425, y, { width: 70, align: "right" });
        doc.fillColor("#000").fontSize(9);
        y += 13;
      }
      // Langtext (BT-154) als Rich-Text unter der Bezeichnung, kleinere Schrift.
      if (line.descriptionLong) {
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
    // dann Steuersätze und Gesamtbetrag.
    y += 10;
    doc.moveTo(left + 300, y).lineTo(right, y).strokeColor("#ccc").stroke();
    y += 6;
    const sumRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      doc.text(label, left + 300, y, { width: 120, align: "right" });
      doc.text(value, left + 425, y, { width: 70, align: "right" });
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
          left + 300,
          y,
          { width: right - (left + 300), align: "right" },
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
    const paymentTermsHuman = data.paymentTermsHuman ?? data.paymentTerms;
    if (paymentTermsHuman) doc.moveDown(0.4).text(paymentTermsHuman, { width: right - left });
    if (data.paymentMethodText) doc.moveDown(0.4).text(data.paymentMethodText, { width: right - left });

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
    const bankLine = [
      data.bankName ? `Bank: ${data.bankName}` : null,
      data.iban ? `IBAN: ${data.iban}` : null,
      data.bic ? `BIC: ${data.bic}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (bankLine) doc.text(bankLine, left, footY + 11, { width: right - left, align: "center" });

    doc.end();
  });
}
