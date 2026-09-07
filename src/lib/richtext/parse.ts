/**
 * Parser für die eingeschränkte Markdown-Teilmenge des Rich-Text-Moduls
 * (§9: kein ungefiltertes HTML, Speicherformat = Markdown-Teilmenge).
 *
 * Unterstützt:
 * - Absätze (durch eine Leerzeile getrennt)
 * - Zeilenumbruch (\n innerhalb eines Absatzes)
 * - **fett**, _kursiv_, __unterstrichen__ (auch verschachtelt)
 * - ungeordnete Liste ("- ") und geordnete Liste ("1. "), eine Ebene
 * - Links [Text](https://…) oder mailto:… — andere Schemata werden zu
 *   Klartext (siehe sanitize.ts)
 *
 * Alles, was nicht diesem Format entspricht, bleibt Klartext. Es wird nie
 * rohes HTML durchgereicht; das Escaping erfolgt beim Rendern (render-html.ts).
 */
import { isAllowedHref } from "./sanitize";
import type { Block, Run } from "./types";

const UNORDERED_MARKER = /^-\s+/;
const ORDERED_MARKER = /^\d+\.\s+/;
const LINK_PATTERN = /^\[([^\]]*)\]\(([^)]*)\)/;

interface InlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function activeFlags(state: InlineState): Pick<Run, "bold" | "italic" | "underline"> {
  const flags: Pick<Run, "bold" | "italic" | "underline"> = {};
  if (state.bold) flags.bold = true;
  if (state.italic) flags.italic = true;
  if (state.underline) flags.underline = true;
  return flags;
}

/**
 * Parst eine Zeile/einen Absatztext (kann eingebettete \n enthalten) in eine
 * flache Liste von Runs. Verschachtelte Formatierung (z. B. **fett _und
 * kursiv_**) wird durch kombinierte Flags je Run abgebildet, nicht durch
 * verschachtelte Strukturen.
 */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const state: InlineState = { bold: false, italic: false, underline: false };
  let buffer = "";
  let i = 0;

  const flush = (): void => {
    if (buffer.length > 0) {
      runs.push({ text: buffer, ...activeFlags(state) });
      buffer = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    if (text[i] === "[") {
      const match = LINK_PATTERN.exec(rest);
      if (match) {
        const [full, label, href] = match;
        flush();
        if (isAllowedHref(href)) {
          runs.push({ text: label, href, ...activeFlags(state) });
        } else {
          // Verbotenes Schema (z. B. javascript:, data:, relativ) -> Klartext.
          if (label.length > 0) {
            runs.push({ text: label, ...activeFlags(state) });
          }
        }
        i += full.length;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      flush();
      state.bold = !state.bold;
      i += 2;
      continue;
    }

    if (rest.startsWith("__")) {
      flush();
      state.underline = !state.underline;
      i += 2;
      continue;
    }

    if (text[i] === "_") {
      flush();
      state.italic = !state.italic;
      i += 1;
      continue;
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  return runs;
}

/** Prüft, ob alle nicht-leeren Zeilen eines Chunks demselben Listenmarker folgen. */
function detectListKind(lines: string[]): "unordered" | "ordered" | null {
  if (lines.length === 0) return null;
  if (lines.every((line) => UNORDERED_MARKER.test(line))) return "unordered";
  if (lines.every((line) => ORDERED_MARKER.test(line))) return "ordered";
  return null;
}

/**
 * Parst den Markdown-Teilmengentext in eine Liste von Blöcken.
 * Leere Eingabe ergibt eine leere Liste.
 */
export function parseRichText(markdown: string): Block[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const trimmed = normalized.replace(/^\n+/, "").replace(/\n+$/, "");
  if (trimmed.trim() === "") return [];

  // Absätze sind durch eine (oder mehrere) Leerzeilen getrennt.
  const chunks = trimmed.split(/\n[ \t]*\n+/);
  const blocks: Block[] = [];

  for (const rawChunk of chunks) {
    const chunk = rawChunk.replace(/^[ \t]+|[ \t]+$/g, "");
    if (chunk === "") continue;

    const lines = chunk.split("\n");
    const listKind = detectListKind(lines);

    if (listKind === "unordered") {
      blocks.push({
        type: "list",
        ordered: false,
        items: lines.map((line) => parseInline(line.replace(UNORDERED_MARKER, ""))),
      });
      continue;
    }

    if (listKind === "ordered") {
      blocks.push({
        type: "list",
        ordered: true,
        items: lines.map((line) => parseInline(line.replace(ORDERED_MARKER, ""))),
      });
      continue;
    }

    blocks.push({ type: "paragraph", runs: parseInline(chunk) });
  }

  return blocks;
}
