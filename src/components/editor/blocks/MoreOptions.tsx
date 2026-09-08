"use client";

/**
 * "Weitere Optionen"-Block (Phase 11c, Task 4; Fix 1 ergaenzt "Hinweis / Notiz"):
 * eingeklappte `<details>`, Inhalt je Modus. INVOICE: Bestellnummer/interne Referenz/
 * Leitweg-ID/Leistungszeitraum, Beleg-Rabatt/-Aufschlag, Skonto 1/2. DOCUMENT:
 * Lieferbedingungen/Zahlungsbedingungen (mit `TextTemplatePicker` TERMS_*),
 * Beleg-Rabatt/-Aufschlag. DELIVERY_NOTE: Darstellungs-Schalter. ALLE DREI zusaetzlich:
 * "Hinweis / Notiz" (`notes` — eigenstaendig, unabhaengig vom `headerText`-Kopftext aus
 * `HeadTextBlock`, siehe dort), interne Notizen, Druckoptionen (ausser DELIVERY_NOTE).
 *
 * `PrintOptionsPanel` (Phase 7/11b) nur bei Bearbeiten (braucht eine `docId`) — DIESES
 * Panel speichert sofort (eigener PUT-Request), unabhaengig vom uebrigen Editor-`save()`.
 * DELIVERY_NOTE zeigt keine Druckoptionen (Brief nennt sie dort nicht — Lieferscheine
 * haben im Editor keine Layout-/Druckoptionen-Bedienung).
 */
import { useId } from "react";
import type { DraftState, DraftAction } from "@/lib/editor/draft";
import type { EditorMode } from "@/lib/editor/constants";
import { SCHEME_NOTICE } from "@/lib/editor/constants";
import { SCHEME_NOTICE_ACCEPTED, normalizeNotice } from "@/domain/invoice/mandatory";
import type { EffectivePrintOptions } from "@/lib/pdf/theme";
import type { PrintOptionsOverride } from "@/schemas";
import type { LayoutId } from "@/lib/pdf/layouts/ids";
import { EditorField } from "../EditorField";
import { inputCls } from "@/components/forms/fields";
import { TextTemplatePicker } from "../TextTemplatePicker";
import { PrintOptionsPanel } from "@/components/PrintOptionsPanel";

// M10 (Abschluss-Review): generisch ueber `K`, damit `DraftAction`s Feld/Wert-Korrelation
// (`draft.ts`, `SetAction`) auch durch diesen Helfer hindurch am Aufrufort geprueft wird —
// vorher haette z. B. `set(dispatch, "showPrices", "ja")` unbemerkt kompiliert.
function set<K extends keyof DraftState>(dispatch: (action: DraftAction) => void, field: K, value: DraftState[K]) {
  dispatch({ type: "set", field, value } as DraftAction);
}

/**
 * Label + `TextTemplatePicker` nebeneinander, Textarea darunter — wie `HeadTextBlock`
 * NICHT ueber `EditorField` (das legt Label/Kind strikt untereinander an), aber
 * gleiches Prinzip: eigene `useId()`-Kennung, echtes `<label htmlFor>`.
 */
function TermsField({
  label,
  value,
  onChange,
  docType,
  position,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  docType: string;
  position: "TERMS_DELIVERY" | "TERMS_PAYMENT";
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium text-slate-700">
          {label}
        </label>
        <TextTemplatePicker docType={docType} position={position} onPick={onChange} />
      </div>
      <textarea id={id} className={inputCls} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function MoreOptions({
  mode,
  isEdit,
  draft,
  dispatch,
  effectivePrintOptions,
  printOverride,
  layouts,
}: {
  mode: EditorMode;
  isEdit: boolean;
  draft: DraftState;
  dispatch: (action: DraftAction) => void;
  effectivePrintOptions?: EffectivePrintOptions;
  printOverride?: PrintOptionsOverride;
  layouts: { id: LayoutId; name: string }[];
}) {
  const printApiKind = mode === "INVOICE" ? "invoices" : "documents";
  const showPrintOptions = mode !== "DELIVERY_NOTE";
  // Fix 1 (Koordinator-Ruling): "Hinweis / Notiz" bindet an `notes` — ein von
  // `headerText` (jetzt `HeadTextBlock`) unabhaengiges Feld. Bei INVOICE zusaetzlich der
  // bestehende Pflichthinweis-Automatismus (Kleinunternehmer/Reverse-Charge/
  // Differenzbesteuerung, `toInvoicePayload` haengt ihn vor `notes`).
  const notice = mode === "INVOICE" ? SCHEME_NOTICE[draft.taxScheme] : undefined;

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer select-none font-semibold text-slate-900">Weitere Optionen</summary>
      <div className="mt-4 space-y-4">
        {mode === "INVOICE" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <EditorField label="Bestellnummer">
              {(id) => <input id={id} className={inputCls} value={draft.orderNumber} onChange={(e) => set(dispatch, "orderNumber", e.target.value)} />}
            </EditorField>
            <EditorField label="Interne Referenz">
              {(id) => <input id={id} className={inputCls} value={draft.internalReference} onChange={(e) => set(dispatch, "internalReference", e.target.value)} />}
            </EditorField>
            <EditorField label="Leitweg-ID (Override)" hint="Standard des Kunden, falls leer">
              {(id) => <input id={id} className={inputCls} value={draft.buyerReference} onChange={(e) => set(dispatch, "buyerReference", e.target.value)} />}
            </EditorField>
            <div className="grid grid-cols-2 gap-2">
              <EditorField label="Leistungszeitraum von">
                {(id) => <input id={id} type="date" className={inputCls} value={draft.deliveryStart} onChange={(e) => set(dispatch, "deliveryStart", e.target.value)} />}
              </EditorField>
              <EditorField label="bis">
                {(id) => <input id={id} type="date" className={inputCls} value={draft.deliveryEnd} onChange={(e) => set(dispatch, "deliveryEnd", e.target.value)} />}
              </EditorField>
            </div>
          </div>
        )}

        {mode === "DOCUMENT" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TermsField
              label="Lieferbedingungen"
              value={draft.deliveryTerms}
              onChange={(v) => set(dispatch, "deliveryTerms", v)}
              docType={draft.kind}
              position="TERMS_DELIVERY"
            />
            <TermsField label="Zahlungsbedingungen" value={draft.paymentTerms} onChange={(v) => set(dispatch, "paymentTerms", v)} docType={draft.kind} position="TERMS_PAYMENT" />
          </div>
        )}

        {mode === "INVOICE" && (
          <EditorField label="Zahlungsbedingungen">
            {(id) => <textarea id={id} className={inputCls} rows={2} value={draft.paymentTerms} onChange={(e) => set(dispatch, "paymentTerms", e.target.value)} />}
          </EditorField>
        )}

        {(mode === "INVOICE" || mode === "DOCUMENT") && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Beleg-Rabatt / -Aufschlag</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <EditorField label="Rabatt %" hint="leer = Kundenvorgabe">
                {(id) => <input id={id} className={inputCls} value={draft.documentDiscountPercent} onChange={(e) => set(dispatch, "documentDiscountPercent", e.target.value)} />}
              </EditorField>
              <EditorField label="Rabatt € (zusätzlich)">
                {(id) => <input id={id} className={inputCls} value={draft.documentDiscountAmount} onChange={(e) => set(dispatch, "documentDiscountAmount", e.target.value)} />}
              </EditorField>
              <EditorField label="Aufschlag %">
                {(id) => <input id={id} className={inputCls} value={draft.documentChargePercent} onChange={(e) => set(dispatch, "documentChargePercent", e.target.value)} />}
              </EditorField>
              <EditorField label="Aufschlag € (zusätzlich)">
                {(id) => <input id={id} className={inputCls} value={draft.documentChargeAmount} onChange={(e) => set(dispatch, "documentChargeAmount", e.target.value)} />}
              </EditorField>
              <EditorField label="Grund für Aufschlag/Rabatt" hint="optional" className="sm:col-span-2">
                {(id) => <input id={id} className={inputCls} placeholder="z. B. Expresszuschlag" value={draft.documentChargeReason} onChange={(e) => set(dispatch, "documentChargeReason", e.target.value)} />}
              </EditorField>
            </div>
          </div>
        )}

        {mode === "INVOICE" && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Skonto</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <EditorField label="Skonto 1 — Prozent" hint="z. B. 2">
                {(id) => <input id={id} className={inputCls} value={draft.skonto1Percent} onChange={(e) => set(dispatch, "skonto1Percent", e.target.value)} />}
              </EditorField>
              <EditorField label="Skonto 1 — Tage" hint="z. B. 7">
                {(id) => <input id={id} className={inputCls} value={draft.skonto1Days} onChange={(e) => set(dispatch, "skonto1Days", e.target.value)} />}
              </EditorField>
              <EditorField label="Skonto 2 — Prozent" hint="optional, z. B. 1">
                {(id) => <input id={id} className={inputCls} value={draft.skonto2Percent} onChange={(e) => set(dispatch, "skonto2Percent", e.target.value)} />}
              </EditorField>
              <EditorField label="Skonto 2 — Tage" hint="optional, länger als Skonto 1, z. B. 14">
                {(id) => <input id={id} className={inputCls} value={draft.skonto2Days} onChange={(e) => set(dispatch, "skonto2Days", e.target.value)} />}
              </EditorField>
            </div>
          </div>
        )}

        {mode === "DELIVERY_NOTE" && (
          <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.showArticleNumber} onChange={(e) => set(dispatch, "showArticleNumber", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Artikelnummer anzeigen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.showDescription} onChange={(e) => set(dispatch, "showDescription", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Beschreibung anzeigen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.showPrices} onChange={(e) => set(dispatch, "showPrices", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Preise anzeigen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.showTax} disabled={!draft.showPrices} onChange={(e) => set(dispatch, "showTax", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              USt anzeigen
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.showDeliveryAddress}
                onChange={(e) => set(dispatch, "showDeliveryAddress", e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Lieferadresse anzeigen
            </label>
          </div>
        )}

        {mode === "INVOICE" && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.consumerRetentionHint}
              onChange={(e) => set(dispatch, "consumerRetentionHint", e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="font-medium text-slate-700">Hinweis auf Aufbewahrungspflicht (§ 14b)</span>
              <span className="block text-xs text-slate-400">Bauleistung an eine Privatperson: „Sie sind verpflichtet, diese Rechnung zwei Jahre aufzubewahren.“</span>
            </span>
          </label>
        )}

        <EditorField label="Hinweis / Notiz" hint={notice ? `Pflichthinweis „${notice}“ wird automatisch ergänzt.` : undefined}>
          {(id) => <textarea id={id} className={inputCls} rows={2} value={draft.notes} onChange={(e) => set(dispatch, "notes", e.target.value)} />}
        </EditorField>
        {notice && !SCHEME_NOTICE_ACCEPTED[draft.taxScheme]?.some((re) => re.test(normalizeNotice(draft.notes))) && (
          <button
            type="button"
            onClick={() => set(dispatch, "notes", draft.notes ? `${notice} — ${draft.notes}` : notice)}
            className="text-xs text-indigo-600 hover:underline"
          >
            Pflichthinweis einfügen
          </button>
        )}

        <EditorField
          label="Interne Notiz"
          hint={<span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">nur intern sichtbar — nie in PDF, XRechnung, ZUGFeRD oder Mails</span>}
        >
          {(id) => <textarea id={id} className={inputCls} rows={2} value={draft.internalNotes} onChange={(e) => set(dispatch, "internalNotes", e.target.value)} />}
        </EditorField>

        {showPrintOptions &&
          (isEdit && draft.id && effectivePrintOptions ? (
            <PrintOptionsPanel docId={draft.id} apiKind={printApiKind} effective={effectivePrintOptions} initialOverride={printOverride ?? {}} layouts={layouts} />
          ) : (
            <p className="text-xs text-slate-500">Druckoptionen (Logo-/Layout-Overrides je Beleg) lassen sich erst nach dem Speichern einstellen.</p>
          ))}
      </div>
    </details>
  );
}
