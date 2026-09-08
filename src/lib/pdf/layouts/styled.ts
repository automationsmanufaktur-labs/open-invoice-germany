/**
 * Layout-Fabrik (Phase 11b, Task 5): `blau`/`schwarz`/`kompakt` sind Varianten des
 * Standard-Layouts — gleicher Kopf-/Empfaenger-/Meta-Aufbau (`standardLayout.drawKopf`),
 * nur mit eigener Akzentfarbe (Tabellenkopf, Summenlinie, Fusszeilen-Trennlinie) und
 * eigenem Tabellenstil. `styledLayout` spreadet `standardLayout`, damit spaeter
 * hinzukommende Hooks (z. B. `drawPageChrome`) automatisch mitgezogen werden, ohne
 * dass diese Datei sie kennen muss.
 */
import type { PdfLayout, TableStyle } from "./types";
import { standardLayout } from "./standard";
import { drawFooterColumns } from "./shared";

interface StyledOptions {
  id: PdfLayout["id"];
  name: string;
  description: string;
  /** ueberstimmt brand.primaryColor fuer Tabellenkopf/Summenlinie/Fusszeilen-Trennlinie. */
  accent: string;
  table: Partial<TableStyle>;
  fontDelta?: number;
  footerColor?: string;
}

/** Varianten des Standard-Layouts mit eigener Akzentfarbe und Tabellenstil (blau, schwarz, kompakt). */
export function styledLayout(o: StyledOptions): PdfLayout {
  return {
    ...standardLayout,
    id: o.id,
    name: o.name,
    description: o.description,
    fontDelta: o.fontDelta ?? 0,
    table: { ...standardLayout.table, ...o.table },
    drawKopf(frame, input) {
      return standardLayout.drawKopf({ ...frame, primary: o.accent }, input);
    },
    drawTotalsRule(frame, x, y) {
      frame.doc.moveTo(x, y).lineTo(frame.right, y).lineWidth(1.2).strokeColor(o.accent).stroke().lineWidth(1);
    },
    drawFooter(frame, columns, y) {
      frame.doc.moveTo(frame.left, y - 6).lineTo(frame.right, y - 6).lineWidth(0.6).strokeColor(o.accent).stroke().lineWidth(1);
      drawFooterColumns(frame, columns, y, 7.5, o.footerColor ?? "#555555");
    },
  };
}

export const blauLayout = styledLayout({
  id: "blau",
  name: "Blau",
  description: "Standard-Aufbau mit blauem Tabellenkopf und blauen Linien.",
  accent: "#1d4ed8",
  table: { headerFill: "#1d4ed8", headerText: "#fff", rowRule: "#dbeafe" },
});

export const schwarzLayout = styledLayout({
  id: "schwarz",
  name: "Schwarz",
  description: "Kontrastreich: schwarzer Tabellenkopf, schwarze Linien, graue Fußzeile.",
  accent: "#000000",
  table: { headerFill: "#000000", headerText: "#fff", rowRule: "#e5e7eb" },
  footerColor: "#333333",
});

export const kompaktLayout = styledLayout({
  id: "kompakt",
  name: "Kompakt",
  description: "Kleinere Schrift und engere Zeilen für lange Positionslisten.",
  accent: "#374151",
  table: { headerFill: "#374151", headerText: "#fff", headerHeight: 14, rowRule: "#eeeeee" },
  fontDelta: -1,
});
