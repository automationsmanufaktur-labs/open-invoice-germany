"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Settings {
  autoCreate: boolean;
  autoSend: boolean;
  baseInterestRateBp: number;
  baseRateValidFrom?: string | null;
  gracePeriodDays: number;
}

export function DunningSettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/dunning-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Speichern fehlgeschlagen.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.autoCreate} onChange={(e) => setSettings((s) => ({ ...s, autoCreate: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
        <span className="font-medium text-slate-700">Mahnungen automatisch erstellen (Scheduler)</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.autoSend} onChange={(e) => setSettings((s) => ({ ...s, autoSend: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
        <span className="font-medium text-slate-700">Mahnungen automatisch versenden (§26, zusätzlich je Stufe erforderlich)</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {/* S7 (Fix-Welle): "‰, Basispunkte" war widerspruechlich (‰ = Promille, aber der
              Wert sind Basispunkte — 127 als Promille gelesen waeren 12,7 % statt 1,27 %).
              Klares Beispiel im Label, min/max/step passend zur Zod-Schranke (0..2000),
              Prozentwert direkt daneben zur Kontrolle. */}
          <span className="font-medium text-slate-700">Basiszinssatz in Basispunkten (127 = 1,27 %)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={2000}
              step={1}
              value={settings.baseInterestRateBp}
              onChange={(e) => setSettings((s) => ({ ...s, baseInterestRateBp: Number(e.target.value) }))}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
            <span className="text-xs text-slate-500">= {(settings.baseInterestRateBp / 100).toFixed(2).replace(".", ",")} %</span>
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Karenztage (nur erste Stufe)</span>
          <input
            type="number"
            value={settings.gracePeriodDays}
            onChange={(e) => setSettings((s) => ({ ...s, gracePeriodDays: Number(e.target.value) }))}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
      </div>
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "…" : "Speichern"}
        </button>
        {saved && <span className="text-xs text-emerald-700">Gespeichert.</span>}
      </div>
    </form>
  );
}
