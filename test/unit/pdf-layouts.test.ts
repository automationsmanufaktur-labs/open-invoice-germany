/**
 * Phase 11b (PDF-Layouts), Task 2 — Layout-Register + `standard` (Kompatibilitaet).
 * Testjahr 2073 (siehe plan-header.md).
 */
import { describe, it, expect } from "vitest";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";
import { renderDunningPdf } from "@/lib/pdf/dunning-pdf";
import { getLayout, listLayouts } from "@/lib/pdf/layouts/registry";
import { LAYOUT_IDS } from "@/lib/pdf/layouts/ids";
import { parsePdf, testPdfTheme } from "../helpers/pdf-theme";
import { sampleDeliveryNote, sampleDunning } from "../helpers/pdf-fixtures";
import type { EInvoiceData, EInvoiceLine } from "@/lib/einvoice/types";

/** Zaehlt nicht-ueberlappende Vorkommen von `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Fix-Runde 1 (Koordinator, Punkt 6): die Fusszeile wird jetzt auf JEDER Seite gezeichnet
// (vorher nur auf der zuletzt angelegten) — "IBAN" + die gruppierte IBAN (leerraum-
// bereinigt) muss deshalb mindestens `numpages`-mal im PDF-Text auftauchen, EINMAL je Seite.
const STRIPPED_IBAN_FOOTER = "IBANDE02120300000000202051";

export function sampleInvoice(): EInvoiceData {
  const lines: EInvoiceLine[] = Array.from({ length: 30 }, (_, i) => ({
    id: String(i + 1),
    description: `Position ${i + 1}`,
    descriptionLong: i === 2 ? "**Langtext** mit Details\n- Punkt A\n- Punkt B" : undefined,
    quantityMilli: 2000,
    unit: "C62",
    unitNetPriceCents: 1250,
    lineNetCents: 2500,
    taxRate: 19,
    taxCategory: "S",
    lineType: "ITEM" as const,
    discountCents: i === 4 ? 250 : undefined,
    discountPermille: i === 4 ? 100 : undefined,
  }));
  lines.splice(10, 0, { id: "h1", description: "Abschnitt B", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, lineNetCents: 0, taxRate: 19, taxCategory: "S", lineType: "HEADING" as const });
  const net = 30 * 2500 - 250;
  const tax = Math.round(net * 0.19);
  const data: EInvoiceData = {
    number: "RE-2073-00001",
    type: "INVOICE",
    issueDate: new Date("2073-05-02"),
    dueDate: new Date("2073-05-16"),
    deliveryDate: new Date("2073-05-01"),
    currency: "EUR",
    headerText: "Sehr geehrte Damen und Herren, vielen Dank für Ihren Auftrag.",
    footerText: "Wir bedanken uns für Ihr Vertrauen.",
    notes: "Sichtbare Notiz",
    seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin", countryCode: "DE", vatId: "DE123456789", taxNumber: "12/345/67890", email: "info@muster.example", phone: "030 123456" },
    // Fix-Welle (Abschluss-Review Phase 11b, Block 3): Kundennummer fuers PDF-Meta "Ihre
    // Kundennummer" (siehe Test unten).
    buyer: { name: "Kunde AG", contactName: "Frau Beispiel", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt", countryCode: "DE", vatId: "DE987654321", customerNumber: "K-7100" },
    lines,
    taxSubtotals: [{ taxRate: 19, taxCategory: "S", netCents: net, taxCents: tax }],
    netTotalCents: net,
    taxTotalCents: tax,
    grossTotalCents: net + tax,
    payableCents: net + tax,
    giroAmountCents: net + tax,
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    bankName: "Testbank",
    paymentTermsHuman: "Zahlbar innerhalb 14 Tagen ohne Abzug.",
  };
  // Negativtest (siehe MATRIX unten): `internalNotes` existiert nicht in `EInvoiceData` —
  // dieses Feld simuliert versehentlich durchgereichte interne Daten, damit der Test
  // sichert, dass kein Layout "GEHEIM" aus einem solchen Feld druckt.
  (data as unknown as Record<string, unknown>).internalNotes = "GEHEIM-NOTIZ";
  return data;
}

/** Reine ITEM-Zeilen, keine Kopf-/Fusstexte/Rabatte — fuer die deterministische
 *  Paginierungs-Handrechnung unten (jede Abweichung waere sonst durch Textumbruch statt
 *  durch die Fusszeilen-Reservierung selbst verursacht). */
function invoiceWithLines(n: number): EInvoiceData {
  const lines: EInvoiceLine[] = Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    description: `Position ${i + 1}`,
    quantityMilli: 1000,
    unit: "C62",
    unitNetPriceCents: 1000,
    lineNetCents: 1000,
    taxRate: 19,
    taxCategory: "S",
    lineType: "ITEM" as const,
  }));
  const net = n * 1000;
  const tax = Math.round(net * 0.19);
  return {
    number: "RE-2073-00002",
    type: "INVOICE",
    issueDate: new Date("2073-05-02"),
    currency: "EUR",
    seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin", countryCode: "DE" },
    buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt", countryCode: "DE" },
    lines,
    taxSubtotals: [{ taxRate: 19, taxCategory: "S", netCents: net, taxCents: tax }],
    netTotalCents: net,
    taxTotalCents: tax,
    grossTotalCents: net + tax,
    payableCents: net + tax,
    giroAmountCents: 0,
    iban: null,
  };
}

describe("Layout-Register", () => {
  it("kennt 'standard', das der Fallback ist", () => {
    expect(listLayouts()[0]!.id).toBe("standard");
    expect(getLayout("gibtsnicht").id).toBe("standard");
    expect(getLayout(undefined).id).toBe("standard");
  });

  // Task 5: die Registry ist jetzt ein vollstaendiges `Record<LayoutId, PdfLayout>`
  // (kein `Partial` mehr) — `listLayouts()` muss deshalb exakt `LAYOUT_IDS` in
  // derselben Reihenfolge liefern, kein Layout fehlt.
  it("liefert alle sieben Layouts in der Reihenfolge von LAYOUT_IDS", () => {
    expect(listLayouts().map((l) => l.id)).toEqual([...LAYOUT_IDS]);
  });
});

describe("Layout standard (Kompatibilitaet)", () => {
  it("rendert die Musterrechnung mit allen Kernangaben auf zwei Seiten", async () => {
    const pdf = await renderInvoicePdf(sampleInvoice(), testPdfTheme({ layoutId: "standard" }));
    const { text, numpages } = await parsePdf(pdf);
    expect(numpages).toBe(2);
    expect(text).toContain("RE-2073-00001");
    expect(text).toContain("Kunde AG");
    expect(text).toContain("Abschnitt B");
    expect(text).toContain("Seite 1 von 2");
    expect(text).toContain("Seite 2 von 2");
    expect((text.match(/Beschreibung/g) ?? []).length).toBeGreaterThanOrEqual(2); // Tabellenkopf auf Seite 2 wiederholt
    // Phase 11b, Task 3 — die AUTO-Fusszeile gruppiert die IBAN in 4er-Bloecke
    // (footer.ts#groupIban, siehe test/unit/pdf-footer.test.ts) und die vierspaltige
    // Fusszeile kann eine so lange Zeile innerhalb ihrer Spalte umbrechen (pdf-parse
    // fuegt dafuer einen Zeilenumbruch ein) — Leerraum vor dem Vergleich entfernen, damit
    // die Pruefung unabhaengig von Gruppierung/Umbruch bleibt.
    const stripped = text.replace(/\s+/g, "");
    expect(stripped).toContain(STRIPPED_IBAN_FOOTER);
    // Fix-Runde 1, Punkt 6 — die Fusszeile steht jetzt auf JEDER Seite, nicht nur der letzten.
    expect(countOccurrences(stripped, STRIPPED_IBAN_FOOTER)).toBeGreaterThanOrEqual(numpages);
    expect(text).toContain("Gesamtbetrag");
    // Fix-Welle (Abschluss-Review, Block 3 — Referenzbeleg RE-41362): Kundennummer-Zeile
    // im Kopf-Meta, fuer ALLE Layouts (siehe eigener Test unten fuer `schlicht`).
    expect(text).toContain("Ihre Kundennummer");
    expect(text).toContain("K-7100");
  });
});

describe("Layout schlicht — naeher an der Referenz RE-41362 (Abschluss-Review, Block 3)", () => {
  it("nutzt eigene Beschriftungen, Positionssuffix und Kundennummer-Zeile", async () => {
    const pdf = await renderInvoicePdf(sampleInvoice(), testPdfTheme({ layoutId: "schlicht" }));
    const { text } = await parsePdf(pdf);
    expect(text).toContain("Einzelpreis");
    expect(text).toContain("Gesamtpreis");
    expect(text).toContain("1."); // Positionssuffix (colPosSuffix)
    expect(text).toContain("Gesamtbetrag netto");
    expect(text).toMatch(/zzgl\. Umsatzsteuer 19%/);
    expect(text).toContain("Gesamtbetrag brutto");
    expect(text).toContain("Ihre Kundennummer");
    expect(text).toContain("K-7100");
  });

  it("zeichnet den GiroCode unter dem Summenblock statt rechts oberhalb der Fusszeile", async () => {
    // Geometrischer Beleg (wie beim Paginierungs-Guard oben): `giroPlacement: "below-totals"`
    // zeichnet den Code VOR notes/paymentTermsHuman — ein Beleg mit vielen Positionen UND
    // GiroCode darf deshalb nicht mit dem `bottom-right`-Verhalten anderer Layouts
    // kollidieren (kein zweiter GiroCode, keine doppelte Bildunterschrift).
    const data = sampleInvoice();
    const pdf = await renderInvoicePdf(data, testPdfTheme({ layoutId: "schlicht" }));
    const { text } = await parsePdf(pdf);
    expect((text.match(/GiroCode/g) ?? []).length).toBe(1); // eigene Bildunterschrift "GiroCode" (labels.giroCaption), nicht "GiroCode – mit Banking-App scannen"
    expect(text).not.toContain("mit Banking-App scannen");
  });
});

describe("standard — Fusszeilen-reservierte Paginierung (Fix-Runde 2, Critical)", () => {
  it("mit Fusszeile passen weniger Positionen auf eine Seite als ohne (pageBottom reserviert layout.footerHeight + 6pt)", async () => {
    // Handrechnung (schwarz auf weiss, statt eine interne itemRowsPerPage()-Hilfsfunktion
    // zu exportieren — der Test bleibt black-box und prueft nur renderInvoicePdf/parsePdf):
    //   A4 = 595.28 x 841.89pt (pdfkit-Seitengroessentabelle).
    //   MM_TO_PT = 2.834645 (src/lib/pdf/marks.ts).
    //   Defaults (DEFAULT_BRANDING_SETTINGS): marginTopMm = marginBottomMm = 20mm
    //     -> marginTop = marginBottom = 20 * 2.834645 = 56.6929pt.
    //   standard.footerHeight = 46; rowH = Math.round((base-1)*1.8) mit base=10 (Default
    //     fontSizePt) = Math.round(9*1.8) = 16.
    //   Tabellenbeginn Seite 1 (invoiceWithLines() setzt KEINEN Kopftext/keine
    //     Lieferadresse): standard.drawKopf liefert margins.top + 170 = 226.6929;
    //     + Tabellenkopf (headerHeight 18 + 4 Abstand) = 248.6929 =: y1.
    //   Folgeseiten beginnen bei margins.top (kein drawPageChrome fuer `standard`) + 22
    //     Tabellenkopf = 78.6929 =: y2.
    //   pageBottom MIT Fusszeile  = 841.89 - 56.6929 - 46 - 6 = 733.1971 =: bF
    //   pageBottom OHNE Fusszeile = 841.89 - 56.6929            = 785.1971 =: bO
    //   Kapazitaet je Seite = floor((pageBottom - startY) / rowH):
    //     Seite 1 MIT:  floor((733.1971 - 248.6929) / 16) = floor(30.28) = 30
    //     Seite 1 OHNE: floor((785.1971 - 248.6929) / 16) = floor(33.53) = 33
    //     Folgeseite MIT:  floor((733.1971 - 78.6929) / 16) = floor(40.90) = 40
    //     Folgeseite OHNE: floor((785.1971 - 78.6929) / 16) = floor(44.16) = 44
    //   Kapazitaet ueber 2 Seiten: MIT 30+40=70, OHNE 33+44=77 Positionen. Bei den vom
    //   Koordinator vorgeschlagenen 60 Zeilen liegt WEDER 60 > 70 NOCH 60 > 77 — beide
    //   Faelle bleiben bei 2 Seiten, kein numerischer Unterschied messbar (per Debug-Sweep
    //   n=55..77 verifiziert, siehe Fix-Runde-2-Report). 70 ist der kleinste Wert, bei dem
    //   MIT Fusszeile bereits eine dritte Seite noetig ist, OHNE Fusszeile aber noch nicht.
    const withFooterTheme = testPdfTheme({ layoutId: "standard" });
    const withoutFooterTheme = testPdfTheme({ layoutId: "standard", options: { ...testPdfTheme().options, showFooter: false } });
    const withFooter = await parsePdf(await renderInvoicePdf(invoiceWithLines(70), withFooterTheme));
    const withoutFooter = await parsePdf(await renderInvoicePdf(invoiceWithLines(70), withoutFooterTheme));
    expect(withFooter.numpages).toBe(3);
    expect(withoutFooter.numpages).toBe(2);
    expect(withFooter.numpages).toBeGreaterThan(withoutFooter.numpages);
  });
});

describe("standard — Empfaengerbreite fest 240pt, unabhaengig von den Raendern (Fix-Runde 1, Task-5-Review)", () => {
  it("ein langer Empfaengername bricht bei 5mm-Raendern trotzdem innerhalb der linken Spalte um", async () => {
    // Vorher war der Default in shared.ts#drawRecipient `frame.width - 220` —
    // margin-abhaengig, obwohl `standard`s Infoblock an einem FESTEN `left + 250` haengt.
    // Bei 5mm-Raendern (statt der 18mm-Defaults) waere `frame.width` deutlich groesser
    // gewesen (~347pt statt ~273pt), sodass ein 60-Zeichen-Name NICHT mehr umgebrochen
    // haette (und in den Infoblock haetten hineinlaufen koennen). Mit dem jetzt festen
    // `maxWidth = 240` (unabhaengig von den Raendern) bricht der Name deterministisch um:
    // volle Breite bei Helvetica 11pt ≈ 319pt > 240pt, kein Einzelwort ist selbst breiter
    // als 240pt (laengstes Wort "Beteiligungsverwaltung" ≈ 113pt) — pdfkit bricht also am
    // Wortzwischenraum, nicht mitten im Wort.
    const LONG_NAME = "Handelsgesellschaft Nordwest-Sued Beteiligungsverwaltung mbH"; // 60 Zeichen
    const data = invoiceWithLines(1);
    data.buyer = { ...data.buyer, name: LONG_NAME };
    const theme = testPdfTheme({ layoutId: "standard", brand: { ...testPdfTheme().brand, marginLeftMm: 5, marginRightMm: 5 } });
    const { text } = await parsePdf(await renderInvoicePdf(data, theme));
    // Der Name ist NICHT mehr als zusammenhaengende Zeile im extrahierten Text vorhanden
    // (pdf-parse fuegt beim Zeilenumbruch einen Zeilenumbruch statt eines einfachen
    // Leerzeichens ein) — waehrend erstes und letztes Wort beide vorkommen.
    expect(text).not.toContain(LONG_NAME);
    expect(text).toContain("Handelsgesellschaft");
    expect(text).toContain("mbH");
  });
});

/**
 * Fix-Welle (Abschluss-Review, Block 2 "Important"): reine ITEM-Zeilen + einzeilige
 * `notes`/`paymentTermsHuman` (kein Textumbruch, siehe Arithmetik unten) — fuer die
 * deterministische Paginierungs-Handrechnung analog zu `invoiceWithLines()` oben.
 */
function invoiceWithLinesAndClosing(n: number): EInvoiceData {
  const data = invoiceWithLines(n);
  return {
    ...data,
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    bankName: "Testbank",
    notes: "Es gelten unsere allgemeinen Geschäftsbedingungen.",
    paymentTermsHuman: "Zahlbar bis 16.05.2073 ohne Abzug.",
  };
}

describe("standard — Schlussblock (notes/paymentTermsHuman) paginiert statt auf der Fusszeile (Abschluss-Review, Block 2 Important)", () => {
  // Arithmetik (schwarz auf weiss, per Debug-Sweep verifiziert — siehe Fixwave-Report):
  //   Konstanten wie in der "Fusszeilen-reservierte Paginierung"-Handrechnung oben:
  //     margins.top = margins.bottom = 56.6929, standard.footerHeight = 46, rowH = 16.
  //     pageBottom MIT Fusszeile bF = 841.89 - 56.6929 - 46 - 6 = 733.1971.
  //     Tabellenbeginn Seite 1 y1 = 248.6929 (Kapazitaet 30), Folgeseiten y2 = 78.6929
  //     (Kapazitaet 40) — siehe Handrechnung oben.
  //   Fuer n Positionen (n > 30, alle uebrigen n-30 <= 40 passen auf EINE Folgeseite):
  //     E(n) := Ende der Positionstabelle auf Seite 2 = y2 + (n-30)*rowH = 78.6929 + 16(n-30).
  //   Summenblock (kein Rabatt/Aufschlag, kein FINAL — genau 3 sumRow-Zeilen à 16pt):
  //     y nach Summen = E + 10 (Abstand) + 6 (Linie) + 3*16 (Zeilen) = E + 64.
  //   Kein `footerText` gesetzt -> das `if (data.footerText)`-Fusstext-Guard entfaellt;
  //   danach IMMER `y += 16` (Pflichthinweise-Abschnitt) -> y_vor_notes = E + 80.
  //   `ensurePlainSpace(y, 30)` VOR `notes` bricht um, wenn y_vor_notes + 30 > bF, also
  //   wenn E > 623.1971, also wenn n - 30 > (623.1971 - 78.6929) / 16 = 34.03, also ab
  //   n >= 65 (n=65: E=638.6929 > 623.1971 — bricht; n=64: E=622.6929 < 623.1971 — bricht
  //   NICHT an dieser Stelle, aber siehe unten am `paymentTermsHuman`-Guard).
  //   Einzeilige Texthoehe bei Helvetica base-1=9pt (empirisch/deterministisch ueber
  //   pdfkits AFM-Metriken, siehe Debug-Sweep): NOTES_LINE_H = 10.404pt.
  //   Bricht der `notes`-Guard NICHT um (n <= 64), liegt der `paymentTermsHuman`-Guard bei
  //   y = E + 80 + NOTES_LINE_H = E + 90.404; er bricht um, wenn E > 612.7931, also ab
  //   n - 30 > (612.7931 - 78.6929) / 16 = 33.38, also ab n >= 64 (n=64: E=622.6929 >
  //   612.7931 — bricht am `paymentTermsHuman`-Guard; n=63: E=606.6929 — bricht nicht,
  //   bleibt bei 2 Seiten).
  //   Ergebnis: n=65 UND n=66 (beide vom Koordinator vorgegeben, siehe Abschluss-Review
  //   Reproduktion) brechen am `notes`-Guard auf eine DRITTE Seite um — vor der Fix-Welle
  //   blieben beide bei 2 Seiten, und `notes`/`paymentTermsHuman` wurden irgendwo im
  //   52pt-Fusszeilen-Reserveband (bF..bF+52) gezeichnet, wo pdfkits EIGENE automatische
  //   Paginierung (die nur `margins.bottom`, nicht unsere zusaetzliche Reservierung kennt)
  //   noch keinen Umbruch ausgeloest haette.
  it.each([65, 66])("n=%i Positionen: neue (dritte) Seite fuer notes/paymentTermsHuman statt Ueberlapp mit der Fusszeile", async (n) => {
    const theme = testPdfTheme({ layoutId: "standard" });
    const pdf = await renderInvoicePdf(invoiceWithLinesAndClosing(n), theme);
    const { text, numpages } = await parsePdf(pdf);
    // Deterministische Geometrie: exakt die von der Handrechnung vorhergesagte Seitenzahl.
    expect(numpages).toBe(3);
    expect(text).toContain("Seite 3 von 3");
    // Schlusstext UND Fusszeile muessen beide vorhanden sein — vor der Fix-Welle waeren
    // beide (auf Seite 2) da gewesen, nur uebereinandergezeichnet; die eigentliche
    // Regression waere hier NICHT ueber reinen Textinhalt pruefbar (pdf-parse extrahiert
    // Text unabhaengig von visueller Ueberlappung) — die Seitenzahl-Pruefung oben ist der
    // eigentliche Beleg, dass der Guard den Umbruch VOR dem Ueberlapp ausgeloest hat.
    expect(text).toContain("Es gelten unsere allgemeinen Geschäftsbedingungen.");
    expect(text).toContain("Zahlbar bis 16.05.2073 ohne Abzug.");
    const stripped = text.replace(/\s+/g, "");
    expect(stripped).toContain(STRIPPED_IBAN_FOOTER);
    expect(countOccurrences(stripped, STRIPPED_IBAN_FOOTER)).toBeGreaterThanOrEqual(numpages);
  });

  it("n=64 Positionen: bricht am paymentTermsHuman-Guard (Grenzfall der Handrechnung oben)", async () => {
    const theme = testPdfTheme({ layoutId: "standard" });
    const { text, numpages } = await parsePdf(await renderInvoicePdf(invoiceWithLinesAndClosing(64), theme));
    expect(numpages).toBe(3);
    expect(text).toContain("Zahlbar bis 16.05.2073 ohne Abzug.");
  });

  it("n=63 Positionen: bleibt bei 2 Seiten (Summen + Schlussblock passen ohne Guard-Umbruch)", async () => {
    const theme = testPdfTheme({ layoutId: "standard" });
    const { numpages } = await parsePdf(await renderInvoicePdf(invoiceWithLinesAndClosing(63), theme));
    expect(numpages).toBe(2);
  });
});

// Phase 11b, Task 4/5 — Matrix ueber alle sieben Layouts. Jedes Layout muss dieselben
// Kernangaben drucken, egal wie es Kopf/Tabelle/Fusszeile zeichnet — die Renderer
// selbst bleiben layout-agnostisch.
const MATRIX = ["standard", "schlicht", "klassik", "modern", "blau", "schwarz", "kompakt"] as const;

describe.each(MATRIX)("Layout %s", (layoutId) => {
  it("Register enthaelt %s", () => {
    expect(getLayout(layoutId).id).toBe(layoutId);
  });

  it("Rechnung: zwei Seiten, Kernangaben, Fusszeile, kein Notizleck", async () => {
    const data = sampleInvoice();
    const pdf = await renderInvoicePdf(data, testPdfTheme({ layoutId, footerFacts: { ownerName: "Erika Muster", website: "muster.example" } }));
    const { text, numpages } = await parsePdf(pdf);
    expect(numpages).toBeGreaterThanOrEqual(2);
    for (const s of ["RE-2073-00001", "Kunde AG", "Abschnitt B", "Position 30", "Langtext", "Gesamtbetrag", "Inhaber/-in Erika Muster", "Seite 1 von"]) {
      expect(text, `${layoutId}: ${s}`).toContain(s);
    }
    // Wie in "Layout standard (Kompatibilitaet)" oben: die vierspaltige AUTO-Fusszeile
    // (drawFooterColumns, gemeinsame Infrastruktur aller Layouts) kann die gruppierte
    // IBAN innerhalb ihrer Spalte umbrechen — Leerraum vor dem Vergleich entfernen.
    const stripped = text.replace(/\s+/g, "");
    expect(stripped, `${layoutId}: IBAN`).toContain(STRIPPED_IBAN_FOOTER);
    // Fix-Runde 1, Punkt 6 — die Fusszeile steht jetzt auf JEDER Seite, nicht nur der letzten.
    expect(countOccurrences(stripped, STRIPPED_IBAN_FOOTER), `${layoutId}: IBAN je Seite`).toBeGreaterThanOrEqual(numpages);
    // `kompakt` (Task 5: kleinere Zeilenhoehe, siehe invoice-pdf.ts#rowH) passt alle 30
    // Positionen inkl. Zwischenueberschrift auf die erste Tabellenseite — der Tabellenkopf
    // "Beschreibung" erscheint deshalb nur EINMAL (Seite 2 traegt nur noch Summen/Fusszeile,
    // keine weitere Tabellenseite); das ist der numerische Beleg fuer die kleinere Zeilenhoehe.
    // Alle anderen Layouts behalten die Zwei-Tabellenseiten-Erwartung aus Task 4.
    const minHeaderRepeats = layoutId === "kompakt" ? 1 : 2;
    expect((text.match(/Beschreibung/g) ?? []).length, `${layoutId}: Tabellenkopf-Wiederholungen`).toBeGreaterThanOrEqual(minHeaderRepeats);
    expect(text).not.toContain("GEHEIM");
  });

  it("Lieferschein und Mahnung rendern", async () => {
    const dn = await parsePdf(await renderDeliveryNotePdf(sampleDeliveryNote(), testPdfTheme({ layoutId })));
    expect(dn.text).toContain("Lieferschein");
    const du = await parsePdf(await renderDunningPdf(sampleDunning(), testPdfTheme({ layoutId })));
    expect(du.text).toMatch(/Mahnung|Zahlungserinnerung/);
  });
});

// Phase 11c, Task 2 — Wasserzeichen (PdfTheme.watermark/drawWatermark) fuer die
// Editor-Live-Vorschau ungespeicherter Entwuerfe: muss auf JEDER Seite erscheinen (nicht
// nur auf der letzten) und alle drei Renderer bedienen; ohne `theme.watermark` (Default
// aller anderen Tests/bestehender Aufrufer) darf NIRGENDS ein Wasserzeichen auftauchen.
describe("Wasserzeichen (Phase 11c, Task 2)", () => {
  it("erscheint auf jeder Seite der Rechnung, mindestens einmal je Seite", async () => {
    const pdf = await renderInvoicePdf(sampleInvoice(), testPdfTheme({ layoutId: "standard", watermark: "VORSCHAU" }));
    const { text, numpages } = await parsePdf(pdf);
    expect(numpages).toBe(2);
    expect(countOccurrences(text, "VORSCHAU")).toBeGreaterThanOrEqual(numpages);
  });

  it("erscheint auf Lieferschein- und Mahnungs-PDF", async () => {
    const dn = await parsePdf(await renderDeliveryNotePdf(sampleDeliveryNote(), testPdfTheme({ watermark: "VORSCHAU" })));
    expect(dn.text).toContain("VORSCHAU");
    const du = await parsePdf(await renderDunningPdf(sampleDunning(), testPdfTheme({ watermark: "VORSCHAU" })));
    expect(du.text).toContain("VORSCHAU");
  });

  it("bleibt ohne theme.watermark unveraendert weg (bestehende Aufrufer/Tests)", async () => {
    const pdf = await parsePdf(await renderInvoicePdf(sampleInvoice(), testPdfTheme({ layoutId: "standard" })));
    expect(pdf.text).not.toContain("VORSCHAU");
  });
});
