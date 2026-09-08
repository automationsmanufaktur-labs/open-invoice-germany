"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PrintSettingsInput, PrintBooleanKey } from "@/schemas";
import { parseClampedNumberInput } from "@/lib/forms/clamped-number-input";

const LABELS: Record<PrintBooleanKey, string> = {
  showFooter: "Fußzeile anzeigen",
  showPageNumbers: "Seitenzahlen anzeigen",
  foldMarks: "Falzmarken drucken",
  punchMarks: "Lochmarke drucken",
  showArticleNumber: "Artikelnummern-Spalte anzeigen",
  showDescription: "Beschreibungs-Spalte anzeigen",
  showTaxRatePerLine: "USt-Satz je Position anzeigen",
  showLineTotals: "Zeilensummen anzeigen",
  showSenderLine: "Absenderzeile anzeigen",
  showGiroCode: "GiroCode auf Rechnungen anzeigen",
};

const FIELDS = Object.keys(LABELS) as PrintBooleanKey[];

/** Globale Druckoptionen (§36) — Beleg-individuelle Überschreibung passiert im PrintOptionsPanel im jeweiligen Editor. */
export function PrintSettingsForm({ initial }: { initial: PrintSettingsInput }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Fix-Welle 12a, Fix 2: Rohtext waehrend des Tippens, getrennt vom committeten Wert
  // `values.giroSizeMm` — siehe Kommentar in clamped-number-input.ts. `null` = kein
  // aktiver Draft, Feld zeigt den committeten Wert.
  const [giroDraft, setGiroDraft] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    // Vor dem Speichern einen noch nicht per onBlur committeten Draft nachziehen
    // (z. B. wenn der Button ohne vorherigen Fokuswechsel ausgeloest wird).
    const payload: PrintSettingsInput =
      giroDraft !== null ? { ...values, giroSizeMm: parseClampedNumberInput(giroDraft, 15, 40, values.giroSizeMm) } : values;
    if (giroDraft !== null) {
      setValues(payload);
      setGiroDraft(null);
    }
    const res = await fetch("/api/settings/print", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json().catch(() => ({}))) as { settings?: PrintSettingsInput; error?: string };
    if (!res.ok || !j.settings) {
      setError(j.error ?? "Speichern fehlgeschlagen.");
      setSaving(false);
      return;
    }
    setValues(j.settings);
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {saved && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((key) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">{LABELS[key]}</span>
          </label>
        ))}
      </div>
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">GiroCode-Größe (mm)</span>
        <input
          type="number"
          min={15}
          max={40}
          value={giroDraft ?? String(values.giroSizeMm)}
          onChange={(e) => setGiroDraft(e.target.value)}
          onBlur={() => {
            setValues((v) => ({ ...v, giroSizeMm: parseClampedNumberInput(giroDraft ?? String(v.giroSizeMm), 15, 40, v.giroSizeMm) }));
            setGiroDraft(null);
          }}
          className="w-24 rounded border border-slate-300 px-2 py-1"
        />
        <span className="text-xs text-slate-400">15–40 mm. Unter 15 mm wird der Code unzuverlässig scanbar.</span>
      </label>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {saving ? "Speichern…" : "Einstellungen speichern"}
      </button>
    </div>
  );
}
