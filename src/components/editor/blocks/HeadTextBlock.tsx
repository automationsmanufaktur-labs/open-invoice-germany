"use client";

/**
 * Kopftext-Block (Phase 11c, Task 4, Fix 1): Klartext-Textarea + `TextTemplatePicker`
 * (Task 3, Position HEAD) zum manuellen Einfuegen einer Vorlage. Fusstext (footerText,
 * Position FOOT) gehoert zu `FootTextBlock` (Task 5, neben Positionen/Summen) — hier NUR
 * das Kopf-Feld.
 *
 * Baut Label + Textarea bewusst NICHT ueber `EditorField` (das legt Label und Kind
 * strikt untereinander an) — hier steht der `TextTemplatePicker` rechts NEBEN dem
 * Label, darunter die Textarea. Gleiches Prinzip trotzdem: eigene `useId()`-Kennung,
 * echtes `<label htmlFor>`.
 *
 * Gebundenes Feld: `headerText` fuer ALLE DREI Modi (Koordinator-Ruling, Fix 1 — ersetzt
 * die urspruengliche Task-4-Annahme, INVOICE/DELIVERY_NOTE kennten kein `headerText` im
 * Payload). Rechnungen unterstuetzen Kopf-/Fusstext tatsaechlich Ende-zu-Ende: Schema
 * (`createInvoiceSchema`/`updateInvoiceSchema`, `headerText`/`footerText`,
 * max. 5000 Zeichen), `createDraftInvoice` (`src/domain/invoice/create.ts` L159, Auto-
 * Vorbelegung ueber `pickTextTemplate(tx, orgId, "INVOICE", "HEAD")`),
 * `updateDraftInvoice` (`src/domain/invoice/update.ts` L113) sowie der PDF-Mapper.
 * Lieferscheine ebenso (`src/domain/delivery-note/create.ts` L88/92, docType
 * `"DELIVERY_NOTE"`). `notes` ("Hinweis / Notiz") ist ein EIGENES, von `headerText`
 * unabhaengiges Feld (bei INVOICE zusaetzlich mit dem Pflichthinweis-Automatismus bei
 * Kleinunternehmer/Reverse-Charge/Differenzbesteuerung verknuepft) — es lebt (vorerst)
 * in `MoreOptions`, NICHT hier.
 *
 * `docType` fuer `TextTemplatePicker`/Autovorbelegung: INVOICE -> `"INVOICE"`, DOCUMENT
 * -> `draft.kind` (ANGEBOT/AUFTRAGSBESTAETIGUNG/PROFORMA), DELIVERY_NOTE ->
 * `"DELIVERY_NOTE"` (deckungsgleich mit den oben zitierten Domain-Aufrufen).
 *
 * Fuer DOCUMENT bleibt die Autovorbelegung bei Neuanlage (Kopftext + Fusstext +
 * Lieferbedingungen + Zahlungsbedingungen aus den Text-Vorlagen-Defaults) erhalten —
 * als EIN gemeinsamer Effekt in `DocumentEditor.tsx` (deckt auch das footerText-Feld
 * ab, das erst Task 5 rendert; ein Effekt an dieser Stelle koennte footerText nicht
 * sinnvoll mit abdecken).
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

export function HeadTextBlock({ mode, draft, dispatch }: { mode: EditorMode; draft: DraftState; dispatch: (action: DraftAction) => void }) {
  const id = useId();
  const value = draft.headerText;
  const docType = mode === "DOCUMENT" ? draft.kind : mode === "INVOICE" ? "INVOICE" : "DELIVERY_NOTE";

  return (
    <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          Kopftext
        </label>
        <TextTemplatePicker docType={docType} position="HEAD" onPick={(body) => dispatch({ type: "set", field: "headerText", value: insertTemplate(value, body) })} />
      </div>
      <textarea
        id={id}
        className={`${inputCls} w-full min-h-40 resize-y leading-relaxed`}
        rows={8}
        maxLength={LONG_TEXT_MAX}
        value={value}
        onChange={(e) => dispatch({ type: "set", field: "headerText", value: e.target.value })}
      />
      <CharCount value={value} />
    </div>
  );
}
