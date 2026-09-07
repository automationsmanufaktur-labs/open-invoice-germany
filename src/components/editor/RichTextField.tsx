"use client";

/**
 * Rich-Text-Feld fuer Positions-Langbeschreibungen (Phase 4b): Markdown-Teilmenge
 * (§9) mit Toolbar (fett/kursiv/unterstrichen/Liste/Link fuegen Markdown-Marker in
 * die Textarea ein) und Live-Vorschau ueber denselben Renderer wie PDF/HTML.
 *
 * Importiert bewusst NUR aus den einzelnen Modulen (parse/render-html), NICHT aus
 * dem Sammelindex @/lib/richtext/index.ts — dessen renderRichTextPdf haengt an
 * pdfkit und darf nicht in den Client-Bundle wandern.
 */
import { useId, useRef, useState } from "react";
import { parseRichText } from "@/lib/richtext/parse";
import { renderRichTextHtml } from "@/lib/richtext/render-html";

function insertAroundSelection(textarea: HTMLTextAreaElement, before: string, after: string, value: string, onChange: (v: string) => void) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
}

function insertAtLineStart(textarea: HTMLTextAreaElement, prefix: string, value: string, onChange: (v: string) => void) {
  const start = textarea.selectionStart;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + prefix.length, start + prefix.length);
  });
}

export function RichTextField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  function wrap(before: string, after: string) {
    if (!ref.current) return;
    insertAroundSelection(ref.current, before, after, value, onChange);
  }
  function linePrefix(prefix: string) {
    if (!ref.current) return;
    insertAtLineStart(ref.current, prefix, value, onChange);
  }
  function insertLink() {
    if (!ref.current) return;
    insertAroundSelection(ref.current, "[", "](https://)", value, onChange);
  }

  const html = showPreview ? renderRichTextHtml(parseRichText(value)) : "";

  const btn = "rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="font-medium text-slate-700">
          {label}
        </label>
        <div className="flex gap-1">
          <button type="button" className={btn} title="Fett" onClick={() => wrap("**", "**")}>
            <strong>F</strong>
          </button>
          <button type="button" className={btn} title="Kursiv" onClick={() => wrap("_", "_")}>
            <em>K</em>
          </button>
          <button type="button" className={btn} title="Unterstrichen" onClick={() => wrap("__", "__")}>
            <u>U</u>
          </button>
          <button type="button" className={btn} title="Liste" onClick={() => linePrefix("- ")}>
            Liste
          </button>
          <button type="button" className={btn} title="Link" onClick={insertLink}>
            Link
          </button>
          <button type="button" className={btn} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Bearbeiten" : "Vorschau"}
          </button>
        </div>
      </div>
      {showPreview ? (
        <div
          className="min-h-[6rem] rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 [&_a]:text-indigo-600 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          dangerouslySetInnerHTML={{ __html: html || "<p class=\"text-slate-400\">(leer)</p>" }}
        />
      ) : (
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
