/**
 * Rich-Text-Modul (Phase 4b): eingeschränktes Markdown parsen, sicher zu
 * HTML rendern, als pdfkit-Runs rendern, als Klartext ausgeben.
 * Rein, ohne DB- oder Next-Abhängigkeit.
 */
export type { Block, ListBlock, ParagraphBlock, Run } from "./types";
export { parseRichText, parseInline } from "./parse";
export { renderRichTextHtml } from "./render-html";
export { renderRichTextPdf } from "./render-pdf";
export type { RenderPdfOptions } from "./render-pdf";
export { plainText } from "./plain-text";
export { isAllowedHref } from "./sanitize";
