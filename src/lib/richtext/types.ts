/**
 * Typen für das Rich-Text-Modul (Phase 4b).
 *
 * Speicherformat ist eine eingeschränkte Markdown-Teilmenge (siehe parse.ts).
 * Diese Datei definiert die geparste Zwischendarstellung, aus der HTML,
 * PDF-Runs und Klartext erzeugt werden.
 */

/** Ein Textlauf mit optionaler Formatierung und optionalem Link. */
export interface Run {
  /** Rohtext des Laufs; kann eingebettete Zeilenumbrüche (\n) enthalten. */
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Nur gesetzt, wenn das Ziel-Schema erlaubt ist (https:// oder mailto:). */
  href?: string;
}

/** Ein Absatz (durch eine Leerzeile vom nächsten Block getrennt). */
export interface ParagraphBlock {
  type: "paragraph";
  runs: Run[];
}

/** Eine Liste (ungeordnet oder geordnet, eine Ebene). */
export interface ListBlock {
  type: "list";
  ordered: boolean;
  items: Run[][];
}

export type Block = ParagraphBlock | ListBlock;
