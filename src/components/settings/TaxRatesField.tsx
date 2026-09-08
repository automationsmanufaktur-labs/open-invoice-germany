"use client";

/**
 * Steuersatz-Liste in Einstellungen → Belege (Phase 12c, §33): Chip-Liste mit ×-Knopf je
 * Satz, Zahlenfeld (0-100, ganze Zahlen) + "Hinzufügen", 1-10 Einträge. Der Zustand landet
 * in einem versteckten `<input type="hidden" name="taxRates">` innerhalb des bestehenden
 * `<form action={action}>` von `DocumentSettingsForm` — `saveDocumentSettingsAction` liest
 * ihn per JSON.parse, `taxRatesSchema` validiert serverseitig (Dedup/Sortierung übernimmt
 * `normalizeTaxRates` beim Speichern).
 *
 * Fix-Welle 12a (Lehre): das Eingabefeld haelt waehrend des Tippens den Rohtext (`draft`)
 * — KEIN Klemmen bei jedem Tastendruck (siehe `parseClampedNumberInput`-Kommentar). Der
 * Wert wird erst beim Klick auf "Hinzufügen" (bzw. Enter) geparst/validiert.
 */
import { useState } from "react";
import { inputCls } from "@/components/forms/fields";

const MIN_RATES = 1;
const MAX_RATES = 10;

export function TaxRatesField({ initial }: { initial: number[] }) {
  const [rates, setRates] = useState<number[]>(() => [...initial].sort((a, b) => b - a));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addRate() {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      setError("Steuersatz muss eine ganze Zahl zwischen 0 und 100 sein.");
      return;
    }
    if (rates.includes(n)) {
      setDraft("");
      setError(null);
      return;
    }
    if (rates.length >= MAX_RATES) {
      setError(`Maximal ${MAX_RATES} Sätze.`);
      return;
    }
    setRates((rs) => [...rs, n].sort((a, b) => b - a));
    setDraft("");
    setError(null);
  }

  function removeRate(n: number) {
    if (rates.length <= MIN_RATES) return;
    setRates((rs) => rs.filter((r) => r !== n));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {rates.map((r) => (
          <span key={r} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm text-slate-700">
            {r}%
            <button
              type="button"
              onClick={() => removeRate(r)}
              disabled={rates.length <= MIN_RATES}
              className="text-slate-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`${r}% entfernen`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRate();
            }
          }}
          className={`${inputCls} w-24`}
          aria-label="Neuer Steuersatz in Prozent"
          disabled={rates.length >= MAX_RATES}
        />
        <button
          type="button"
          onClick={addRate}
          disabled={rates.length >= MAX_RATES}
          className="text-sm font-medium text-indigo-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
        >
          Hinzufügen
        </button>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-xs text-slate-400">Bereits ausgestellte Belege behalten ihren Satz.</p>

      <input type="hidden" name="taxRates" value={JSON.stringify(rates)} />
    </div>
  );
}
