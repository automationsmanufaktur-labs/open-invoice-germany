/**
 * Rendert geparste Rich-Text-Blöcke als Klartext ohne Auszeichnung, z. B.
 * für BT-154 (Freitext-Position) in XRechnung/ZUGFeRD, wo keine
 * Formatierung übernommen werden kann.
 */
import type { Block, Run } from "./types";

function runsToText(runs: Run[]): string {
  return runs.map((run) => run.text).join("");
}

/** Klartext ohne Formatierung; Listen mit "- "/"1. "-Präfix, Absätze durch Leerzeile getrennt. */
export function plainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "paragraph") {
        return runsToText(block.runs);
      }
      return block.items
        .map((item, index) => `${block.ordered ? `${index + 1}. ` : "- "}${runsToText(item)}`)
        .join("\n");
    })
    .join("\n\n");
}
