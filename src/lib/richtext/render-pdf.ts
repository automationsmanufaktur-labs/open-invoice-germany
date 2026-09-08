/**
 * Rendert geparste Rich-Text-Blöcke als pdfkit-Runs. Funktioniert ohne
 * eigene Seitenumbruch-Logik — pdfkit bricht Text und Seiten automatisch um.
 *
 * Fett/Kursiv werden über einen Fontwechsel (Basisname + "-Bold"/"-Oblique"/
 * "-BoldOblique") abgebildet, Unterstreichung über die pdfkit-Textoption
 * `underline`. Links werden als klickbare pdfkit-Links gerendert (die
 * Zielprüfung ist bereits beim Parsen erfolgt, siehe sanitize.ts).
 */
import type { Block, Run } from "./types";

export interface RenderPdfOptions {
  x: number;
  width: number;
  fontSize?: number;
  /** Basis-Fontname, z. B. "Helvetica" (Standard) oder "Times-Roman". */
  font?: string;
}

const PARAGRAPH_SPACING = 0.5;
const LIST_ITEM_SPACING = 0.15;
const LIST_INDENT = 15;

function fontNameFor(base: string, run: Run): string {
  if (run.bold && run.italic) return `${base}-BoldOblique`;
  if (run.bold) return `${base}-Bold`;
  if (run.italic) return `${base}-Oblique`;
  return base;
}

/**
 * Zerlegt Runs eines Blocks in visuelle Zeilen anhand eingebetteter \n
 * (Zeilenumbruch innerhalb des Absatzes). Leere Segmente (aufeinander-
 * folgende \n) werden als leere Zeile beibehalten.
 */
function splitRunsIntoLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const run of runs) {
    const segments = run.text.split("\n");
    segments.forEach((segment, index) => {
      if (segment.length > 0) {
        lines[lines.length - 1]!.push({ ...run, text: segment });
      }
      if (index < segments.length - 1) {
        lines.push([]);
      }
    });
  }
  return lines;
}

/** Rendert die Zeilen eines Absatzes/Listenelements ab Position x mit gegebener Breite. */
function renderLines(doc: PDFKit.PDFDocument, lines: Run[][], x: number, width: number, base: string): void {
  for (const line of lines) {
    if (line.length === 0) {
      doc.text("", x, doc.y, { width });
      continue;
    }
    line.forEach((run, index) => {
      doc.font(fontNameFor(base, run));
      const options: PDFKit.Mixins.TextOptions = {
        width,
        continued: index < line.length - 1,
        underline: run.underline === true,
      };
      if (run.href) {
        options.link = run.href;
      }
      if (index === 0) {
        doc.text(run.text, x, doc.y, options);
      } else {
        doc.text(run.text, options);
      }
    });
  }
}

/** Rendert Blöcke als pdfkit-Textausgabe in das gegebene PDFDocument. */
export function renderRichTextPdf(doc: PDFKit.PDFDocument, blocks: Block[], opts: RenderPdfOptions): void {
  const base = opts.font ?? "Helvetica";
  const fontSize = opts.fontSize ?? 10;
  doc.fontSize(fontSize);

  for (const block of blocks) {
    if (block.type === "paragraph") {
      const lines = splitRunsIntoLines(block.runs);
      renderLines(doc, lines, opts.x, opts.width, base);
      doc.moveDown(PARAGRAPH_SPACING);
      continue;
    }

    const indentX = opts.x + LIST_INDENT;
    const indentWidth = Math.max(opts.width - LIST_INDENT, 1);
    block.items.forEach((item, index) => {
      const prefix: Run = { text: block.ordered ? `${index + 1}. ` : "• " };
      const lines = splitRunsIntoLines([prefix, ...item]);
      renderLines(doc, lines, indentX, indentWidth, base);
      doc.moveDown(LIST_ITEM_SPACING);
    });
    doc.moveDown(PARAGRAPH_SPACING - LIST_ITEM_SPACING);
  }
}
