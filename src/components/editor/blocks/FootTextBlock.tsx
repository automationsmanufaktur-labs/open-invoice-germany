"use client";

/**
 * Fusstext-Block (Phase 11c, Task 5): Klartext-Textarea + `TextTemplatePicker`
 * (Task 3, Position FOOT) — spiegelt `HeadTextBlock` (Task 4, Fix 1) exakt, nur fuer
 * `footerText` statt `headerText`. `notes` ("Hinweis / Notiz") bleibt bewusst in
 * `MoreOptions` (Koordinator-Vorgabe fuer Task 5 — dort seit Task 4 samt dem
 * Pflichthinweis-Automatismus bei INVOICE verankert, siehe Kommentar in
 * `MoreOptions.tsx`); eine zweite Bindung hier wuerde dasselbe Feld doppelt anzeigen.
 *
 * `docType` fuer `TextTemplatePicker`: INVOICE -> `"INVOICE"`, DOCUMENT -> `draft.kind`,
 * DELIVERY_NOTE -> `"DELIVERY_NOTE"` — identisch zu `HeadTextBlock` (deckt sich mit
 * `pickTextTemplate`-Aufrufen in `src/domain/{invoice,delivery-note}/create.ts`).
 */
import { useId } from "react";
import type { DraftState, DraftAction } from "@/lib/editor/draft";
import { LONG_TEXT_MAX, type EditorMode } from "@/lib/editor/constants";
import { inputCls } from "@/components/forms/fields";
import { CharCount } from "../CharCount";
import { TextTemplatePicker } from "../TextTemplatePicker";

function insertTemplate(current: string, body: string): string {
  return current.trim() === "" ? body : `${current}\n${body}`;
}

export function FootTextBlock({ mode, draft, dispatch }: { mode: EditorMode; draft: DraftState; dispatch: (action: DraftAction) => void }) {
  const id = useId();
  const value = draft.footerText;
  const docType = mode === "DOCUMENT" ? draft.kind : mode === "INVOICE" ? "INVOICE" : "DELIVERY_NOTE";

  return (
    <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          Fußtext
        </label>
        <TextTemplatePicker docType={docType} position="FOOT" onPick={(body) => dispatch({ type: "set", field: "footerText", value: insertTemplate(value, body) })} />
      </div>
      <textarea
        id={id}
        className={`${inputCls} w-full min-h-40 resize-y leading-relaxed`}
        rows={8}
        maxLength={LONG_TEXT_MAX}
        value={value}
        onChange={(e) => dispatch({ type: "set", field: "footerText", value: e.target.value })}
      />
      <CharCount value={value} />
    </div>
  );
}
