"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PrintSettingsInput, PrintOptionsOverride, PrintBooleanKey } from "@/schemas";
import type { LayoutId } from "@/lib/pdf/layouts/ids";
import { parseClampedNumberInput } from "@/lib/forms/clamped-number-input";

const LABELS: Record<PrintBooleanKey, string> = {
  showFooter: "Fußzeile",
  showPageNumbers: "Seitenzahlen",
  foldMarks: "Falzmarken",
  punchMarks: "Lochmarke",
  showArticleNumber: "Artikelnummern-Spalte",
  showDescription: "Beschreibungs-Spalte",
  showTaxRatePerLine: "USt-Satz je Position",
  showLineTotals: "Zeilensummen",
  showSenderLine: "Absenderzeile",
  showGiroCode: "GiroCode",
};

const FIELDS = Object.keys(LABELS) as PrintBooleanKey[];

type ApiKind = "documents" | "invoices" | "delivery-notes";

/**
 * Druckoptionen-Panel im Beleg-Editor (Task-4-Facts): nur DRAFT, zeigt die effektiven
 * (global verschmolzenen) Werte mit „abweichend“-Checkboxen — nur tatsächlich
 * abgehakte Felder gehen als Override in die PUT-Anfrage (printOptionsOverrideSchema).
 */
export function PrintOptionsPanel({
  docId,
  apiKind,
  effective,
  initialOverride,
  layouts,
}: {
  docId: string;
  apiKind: ApiKind;
  /** Phase 11b: `effectivePrintOptions()` (src/domain/settings/print.ts) traegt zusaetzlich
   *  ein optionales `layoutId`, sobald der Beleg (oder die Organisation/der Typ) ein
   *  Layout aufgeloest hat — hier nur gelesen, nie geschrieben. */
  effective: PrintSettingsInput & { layoutId?: LayoutId };
  initialOverride: PrintOptionsOverride;
  /** Die sieben Layouts (Registry, `listLayouts()`) — vom Server uebergeben, damit diese
   *  Client-Komponente die PDF-Renderer nicht mitbuendeln muss. */
  layouts: { id: LayoutId; name: string }[];
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<PrintOptionsOverride>(initialOverride);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(Object.keys(initialOverride).length > 0);
  // Fix-Welle 12a, Fix 2: Rohtext waehrend des Tippens, getrennt vom committeten Wert
  // (siehe clamped-number-input.ts). `null` = kein aktiver Draft.
  const [giroDraft, setGiroDraft] = useState<string | null>(null);
  const committedGiro = overrides.giroSizeMm ?? effective.giroSizeMm;

  function toggleOverride(key: PrintBooleanKey, isOverridden: boolean) {
    setOverrides((o) => {
      const next = { ...o };
      if (isOverridden) {
        next[key] = effective[key];
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function setOverrideValue(key: PrintBooleanKey, value: boolean) {
    setOverrides((o) => ({ ...o, [key]: value }));
  }

  function toggleGiroSizeOverride(isOverridden: boolean) {
    setOverrides((o) => {
      const next = { ...o };
      if (isOverridden) {
        next.giroSizeMm = effective.giroSizeMm;
      } else {
        delete next.giroSizeMm;
      }
      return next;
    });
  }

  function setGiroSizeOverride(value: number) {
    setOverrides((o) => ({ ...o, giroSizeMm: value }));
  }

  function setLayoutOverride(value: string) {
    setOverrides((o) => {
      const next = { ...o };
      if (value) {
        next.layoutId = value as LayoutId;
      } else {
        delete next.layoutId;
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    // Vor dem Speichern einen noch nicht per onBlur committeten Draft nachziehen.
    const payload: PrintOptionsOverride =
      giroDraft !== null ? { ...overrides, giroSizeMm: parseClampedNumberInput(giroDraft, 15, 40, committedGiro) } : overrides;
    if (giroDraft !== null) {
      setOverrides(payload);
      setGiroDraft(null);
    }
    const res = await fetch(`/api/${apiKind}/${docId}/print-options`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Speichern fehlgeschlagen.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-900">
        <span>Druckoptionen (nur dieser Beleg)</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}
          {saved && <p className="text-xs text-emerald-700">Gespeichert.</p>}
          <label className="flex max-w-xs flex-col gap-1 text-xs text-slate-600">
            <span>Layout</span>
            <select
              value={overrides.layoutId ?? ""}
              onChange={(e) => setLayoutOverride(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            >
              <option value="">Organisationsstandard</option>
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS.map((key) => {
              const isOverridden = key in overrides;
              const value = isOverridden ? (overrides[key] as boolean) : effective[key];
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1 text-xs text-slate-500" title="abweichend von der globalen Einstellung">
                    <input type="checkbox" checked={isOverridden} onChange={(e) => toggleOverride(key, e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                    abweichend
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={value}
                      disabled={!isOverridden}
                      onChange={(e) => setOverrideValue(key, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
                    />
                    <span className={isOverridden ? "font-medium text-slate-900" : "text-slate-500"}>{LABELS[key]}</span>
                  </label>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1 text-xs text-slate-500" title="abweichend von der globalen Einstellung">
              <input
                type="checkbox"
                checked={"giroSizeMm" in overrides}
                onChange={(e) => toggleGiroSizeOverride(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              abweichend
            </label>
            <label className="flex items-center gap-2">
              <input
                type="number"
                min={15}
                max={40}
                value={giroDraft ?? String(committedGiro)}
                disabled={!("giroSizeMm" in overrides)}
                onChange={(e) => setGiroDraft(e.target.value)}
                onBlur={() => {
                  if (giroDraft !== null) {
                    setGiroSizeOverride(parseClampedNumberInput(giroDraft, 15, 40, committedGiro));
                    setGiroDraft(null);
                  }
                }}
                className="w-20 rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
              />
              <span className={"giroSizeMm" in overrides ? "font-medium text-slate-900" : "text-slate-500"}>GiroCode-Größe (mm)</span>
            </label>
          </div>
          <button type="button" onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? "Speichern…" : "Druckoptionen speichern"}
          </button>
        </div>
      )}
    </div>
  );
}
