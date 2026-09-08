"use client";

/**
 * Einstellungen -> API (Phase 12d, Task 4): Schalter fuer das Anfrageprotokoll, Filter-
 * zeile/Tabelle (ApiRequestLogTable.tsx) und Detail-Schublade (ApiRequestLogDrawer.tsx).
 * Fix-Welle (m2): ehemals 345 Zeilen in einer Datei, jetzt auf drei aufgeteilt (Panel
 * bleibt bei Einstellungen/Koordination). Zahlenfelder: Draft/onBlur-Muster (Fix-Welle
 * 12a, lib/forms/clamped-number-input.ts). "Protokoll leeren": ConfirmDialog (Phase 12a).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";
import { parseClampedNumberInput } from "@/lib/forms/clamped-number-input";
import { inputCls } from "@/components/forms/fields";
import { ApiRequestLogTable, type KeyOption } from "./ApiRequestLogTable";
import { ApiRequestLogDrawer } from "./ApiRequestLogDrawer";

interface ApiSettings {
  logRequests: boolean;
  logBodies: boolean;
  retentionDays: number;
  maxRows: number;
}

const PRIVACY_NOTE =
  'Standardmäßig aus. Schon im Kopfdaten-Modus werden Pfad (inkl. Query-String), IP-Adresse und User-Agent gespeichert — Query-Parameter mit Namen wie token, secret, password, apiKey, iban, bic oder email werden dabei geschwärzt. "Bodies mitschreiben" kürzt zusätzlich auf 2 KB; in Bodies werden Felder mit Namen wie token, secret, password, apiKey, iban oder bic geschwärzt (E-Mail-Adressen in Bodies bleiben lesbar). Antwort-Bodies werden nur bei Fehlern (Status ≥ 400) gespeichert. Der Authorization-Header wird nie gespeichert.';

interface NumberFieldProps {
  label: string;
  draft: string | null;
  setDraft: (v: string | null) => void;
  committed: number;
  commit: (n: number) => void;
  min: number;
  max: number;
}
function NumberField({ label, draft, setDraft, committed, commit, min, max }: NumberFieldProps) {
  const onBlur = () => {
    commit(parseClampedNumberInput(draft ?? String(committed), min, max, committed));
    setDraft(null);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input type="number" min={min} max={max} value={draft ?? String(committed)} onChange={(e) => setDraft(e.target.value)} onBlur={onBlur} className={`w-24 ${inputCls}`} />
    </label>
  );
}

export function ApiRequestLogPanel({ initialSettings, initialKeys }: { initialSettings: ApiSettings; initialKeys: KeyOption[] }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [maxRowsDraft, setMaxRowsDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearDialogRef = useRef<ConfirmDialogHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Fokus-Rueckgabe der Schublade: die Tabellenzeile, die sie geoeffnet hat (m2-Nachtrag).
  const triggerElRef = useRef<HTMLElement | null>(null);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    let payload = settings;
    if (retentionDraft !== null) payload = { ...payload, retentionDays: parseClampedNumberInput(retentionDraft, 1, 90, settings.retentionDays) };
    if (maxRowsDraft !== null) payload = { ...payload, maxRows: parseClampedNumberInput(maxRowsDraft, 100, 20000, settings.maxRows) };
    setSettings(payload);
    setRetentionDraft(null);
    setMaxRowsDraft(null);
    const res = await fetch("/api/settings/api-log", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = (await res.json().catch(() => ({}))) as { settings?: ApiSettings; error?: string };
    setSaving(false);
    if (!res.ok || !j.settings) {
      setSaveError(j.error ?? "Speichern fehlgeschlagen.");
      return;
    }
    setSettings(j.settings);
    setSaved(true);
    router.refresh();
  }

  async function clearLog() {
    setClearing(true);
    try {
      const res = await fetch("/api/settings/api-log", { method: "DELETE" });
      if (res.ok) setRefreshKey((k) => k + 1);
    } finally {
      setClearing(false);
      clearDialogRef.current?.close();
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded border border-slate-200 p-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            {/* m13: logBodies geht mit logRequests=false immer auf false (vorher blieb es
                im State an, die Checkbox war nur `disabled`, nicht zurueckgesetzt). */}
            <input
              type="checkbox"
              checked={settings.logRequests}
              onChange={(e) => setSettings((s) => ({ ...s, logRequests: e.target.checked, logBodies: e.target.checked ? s.logBodies : false }))}
            />{" "}
            Anfragen protokollieren
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.logBodies} disabled={!settings.logRequests} onChange={(e) => setSettings((s) => ({ ...s, logBodies: e.target.checked }))} className="disabled:opacity-50" /> Bodies mitschreiben
          </label>
        </div>
        <p className="text-xs text-slate-500">{PRIVACY_NOTE}</p>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <NumberField label="Aufbewahrung (Tage)" draft={retentionDraft} setDraft={setRetentionDraft} committed={settings.retentionDays} commit={(n) => setSettings((s) => ({ ...s, retentionDays: n }))} min={1} max={90} />
          <NumberField label="Maximale Zeilen je Organisation" draft={maxRowsDraft} setDraft={setMaxRowsDraft} committed={settings.maxRows} commit={(n) => setSettings((s) => ({ ...s, maxRows: n }))} min={100} max={20000} />
          <button type="button" onClick={save} disabled={saving} className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Speichern…" : "Speichern"}
          </button>
          <button type="button" onClick={() => clearDialogRef.current?.open()} className="rounded border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600">
            Protokoll leeren
          </button>
        </div>
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        {saved && !saveError && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}
      </div>

      <ApiRequestLogTable
        enabled={settings.logRequests}
        initialKeys={initialKeys}
        selectedId={selectedId}
        refreshKey={refreshKey}
        onSelectRow={(id, trigger) => {
          triggerElRef.current = trigger;
          setSelectedId(id);
        }}
      />

      <ApiRequestLogDrawer
        id={selectedId}
        onClose={() => {
          setSelectedId(null);
          triggerElRef.current?.focus();
        }}
      />

      <ConfirmDialog
        ref={clearDialogRef}
        title="Protokoll leeren"
        message="Das gesamte Anfrageprotokoll dieser Organisation wirklich löschen? Dies kann nicht rückgängig gemacht werden."
        confirmLabel="Leeren"
        tone="danger"
        busy={clearing}
        onConfirm={() => void clearLog()}
      />
    </div>
  );
}
