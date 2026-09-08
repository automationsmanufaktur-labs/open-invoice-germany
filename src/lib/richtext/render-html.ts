/**
 * Rendert geparste Rich-Text-Blöcke zu HTML (§9: nur eigener Renderer,
 * kein rohes HTML wird je durchgereicht). Erlaubt sind ausschließlich
 * <p> <strong> <em> <u> <ul> <ol> <li> <a> <br>; alle Attributwerte und
 * Texte werden escaped.
 */
import type { Block, Run } from "./types";

/** Escaped die für HTML-Text und -Attribute kritischen Zeichen. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRun(run: Run): string {
  let content = escapeHtml(run.text).replace(/\n/g, "<br>");

  if (run.href) {
    content = `<a href="${escapeHtml(run.href)}" rel="noopener noreferrer" target="_blank">${content}</a>`;
  }
  if (run.underline) content = `<u>${content}</u>`;
  if (run.italic) content = `<em>${content}</em>`;
  if (run.bold) content = `<strong>${content}</strong>`;

  return content;
}

function renderRuns(runs: Run[]): string {
  return runs.map(renderRun).join("");
}

/** Rendert Blöcke zu HTML. Leere Blockliste ergibt einen leeren String. */
export function renderRichTextHtml(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "paragraph") {
        return `<p>${renderRuns(block.runs)}</p>`;
      }
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${renderRuns(item)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    })
    .join("");
}
