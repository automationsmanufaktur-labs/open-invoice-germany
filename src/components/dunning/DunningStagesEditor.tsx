"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Stage {
  id: string;
  order: number;
  name: string;
  daysAfterDue: number;
  newDueDays: number;
  feeCents: number;
  calculateInterest: boolean;
  includeB2BFlatFee: boolean;
  emailTemplateId: string | null;
  autoSend: boolean;
  enabled: boolean;
}

type StageFields = Pick<Stage, "name" | "daysAfterDue" | "newDueDays" | "feeCents" | "calculateInterest" | "includeB2BFlatFee" | "autoSend" | "enabled">;

const EMPTY_NEW: StageFields = { name: "", daysAfterDue: 14, newDueDays: 14, feeCents: 0, calculateInterest: true, includeB2BFlatFee: false, autoSend: false, enabled: true };

function fieldsOf(s: Stage): StageFields {
  return { name: s.name, daysAfterDue: s.daysAfterDue, newDueDays: s.newDueDays, feeCents: s.feeCents, calculateInterest: s.calculateInterest, includeB2BFlatFee: s.includeB2BFlatFee, autoSend: s.autoSend, enabled: s.enabled };
}

/**
 * Mahnstufen-Verwaltung (Task 4 Facts: einfach halten — Tabelle mit Inline-Bearbeitung,
 * Umsortieren per Hoch/Runter-Buttons statt Drag&Drop). Loeschen nur ohne Mahnungen
 * (409 -> Hinweis, stattdessen deaktivieren).
 */
export function DunningStagesEditor({ initialStages }: { initialStages: Stage[] }) {
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [drafts, setDrafts] = useState<Record<string, StageFields>>(Object.fromEntries(initialStages.map((s) => [s.id, fieldsOf(s)])));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newStage, setNewStage] = useState<StageFields>(EMPTY_NEW);
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  function setDraft(id: string, patch: Partial<StageFields>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function save(id: string) {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/dunning-stages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(drafts[id]),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [id]: j.error ?? "Speichern fehlgeschlagen." }));
      setBusyId(null);
      return;
    }
    setBusyId(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Diese Mahnstufe wirklich löschen?")) return;
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/dunning-stages/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [id]: j.error ?? "Löschen fehlgeschlagen. Stattdessen deaktivieren (enabled=false)." }));
      setBusyId(null);
      return;
    }
    setBusyId(null);
    router.refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const previous = stages; // S3 (Fix-Welle): bei Fehler zurueckrollen statt die lokal
    // getauschte Reihenfolge stehen zu lassen (UI zeigte sonst eine Order, die die DB
    // wegen der abgelehnten Gebuehrenregel gar nicht uebernommen hat).
    const reordered = [...stages];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setStages(reordered);
    setReorderError(null);
    const res = await fetch("/api/dunning-stages/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setStages(previous);
    setReorderError(j.error ?? "Umsortieren fehlgeschlagen.");
  }

  async function createStage() {
    setCreating(true);
    setNewError(null);
    const res = await fetch("/api/dunning-stages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newStage),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setNewError(j.error ?? "Anlegen fehlgeschlagen.");
      setCreating(false);
      return;
    }
    setNewStage(EMPTY_NEW);
    setCreating(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {reorderError && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{reorderError}</div>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Tage nach Fälligkeit</th>
              <th className="px-3 py-2">Neue Frist (Tage)</th>
              <th className="px-3 py-2">Mahnkosten (€)</th>
              <th className="px-3 py-2">Zinsen</th>
              <th className="px-3 py-2">40-€-Pauschale</th>
              <th className="px-3 py-2">Auto-Versand</th>
              <th className="px-3 py-2">Aktiv</th>
              <th className="px-3 py-2 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stages.map((s, i) => {
              const d = drafts[s.id];
              const feeAllowed = s.order >= 2;
              return (
                <tr key={s.id}>
                  <td className="px-3 py-2 text-slate-500">{s.order}</td>
                  <td className="px-3 py-2">
                    <input value={d.name} onChange={(e) => setDraft(s.id, { name: e.target.value })} className="w-40 rounded border border-slate-300 px-2 py-1" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={d.daysAfterDue} onChange={(e) => setDraft(s.id, { daysAfterDue: Number(e.target.value) })} className="w-20 rounded border border-slate-300 px-2 py-1" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={d.newDueDays} onChange={(e) => setDraft(s.id, { newDueDays: Number(e.target.value) })} className="w-20 rounded border border-slate-300 px-2 py-1" />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      disabled={!feeAllowed}
                      value={(d.feeCents / 100).toFixed(2)}
                      onChange={(e) => setDraft(s.id, { feeCents: Math.round(parseFloat(e.target.value.replace(",", ".")) * 100) || 0 })}
                      className="w-20 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100 disabled:text-slate-400"
                      title={feeAllowed ? "" : "Mahnkosten erst ab Stufe 3 (order ≥ 2, COMPLIANCE §12)"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={d.calculateInterest} onChange={(e) => setDraft(s.id, { calculateInterest: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={d.includeB2BFlatFee} onChange={(e) => setDraft(s.id, { includeB2BFlatFee: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={d.autoSend} onChange={(e) => setDraft(s.id, { autoSend: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={d.enabled} onChange={(e) => setDraft(s.id, { enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs disabled:opacity-40">
                          ↑
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs disabled:opacity-40">
                          ↓
                        </button>
                        <button type="button" onClick={() => save(s.id)} disabled={busyId === s.id} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                          Speichern
                        </button>
                        <button type="button" onClick={() => remove(s.id)} disabled={busyId === s.id} className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                          Löschen
                        </button>
                      </div>
                      {errors[s.id] && <span className="text-right text-xs text-rose-600">{errors[s.id]}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Neue Mahnstufe</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Name</span>
            <input value={newStage.name} onChange={(e) => setNewStage((s) => ({ ...s, name: e.target.value }))} className="w-40 rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Tage nach Fälligkeit</span>
            <input type="number" value={newStage.daysAfterDue} onChange={(e) => setNewStage((s) => ({ ...s, daysAfterDue: Number(e.target.value) }))} className="w-24 rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Neue Frist (Tage)</span>
            <input type="number" value={newStage.newDueDays} onChange={(e) => setNewStage((s) => ({ ...s, newDueDays: Number(e.target.value) }))} className="w-24 rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <button type="button" onClick={createStage} disabled={creating || !newStage.name.trim()} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {creating ? "…" : "Stufe anlegen"}
          </button>
        </div>
        {newError && <p className="mt-2 text-xs text-rose-600">{newError}</p>}
      </div>
    </div>
  );
}
