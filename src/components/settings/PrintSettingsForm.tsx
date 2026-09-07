"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PrintSettingsInput } from "@/schemas";

const LABELS: Record<keyof PrintSettingsInput, string> = {
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

const FIELDS = Object.keys(LABELS) as (keyof PrintSettingsInput)[];

/** Globale Druckoptionen (§36) — Beleg-individuelle Überschreibung passiert im PrintOptionsPanel im jeweiligen Editor. */
export function PrintSettingsForm({ initial }: { initial: PrintSettingsInput }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/print", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
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
