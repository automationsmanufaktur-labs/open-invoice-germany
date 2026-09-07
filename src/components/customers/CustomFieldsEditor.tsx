"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CustomFieldDefRow {
  id: string;
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
  optionsJson: string | null;
  required: boolean;
  sortOrder: number;
  isActive: boolean;
}

type Fields = { key: string; label: string; type: CustomFieldDefRow["type"]; options: string; required: boolean; isActive: boolean };

const EMPTY: Fields = { key: "", label: "", type: "TEXT", options: "", required: false, isActive: true };

function fieldsOf(d: CustomFieldDefRow): Fields {
  const options = d.optionsJson ? (JSON.parse(d.optionsJson) as string[]).join(", ") : "";
  return { key: d.key, label: d.label, type: d.type, options, required: d.required, isActive: d.isActive };
}

function toPayload(f: Fields, sortOrder: number) {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    options: f.type === "SELECT" ? f.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
    required: f.required,
    sortOrder,
    isActive: f.isActive,
  };
}

/** Org-weite Kundenfeld-Definitionen (§31) — CRUD + Umsortieren (Hoch/Runter, Muster: DunningStagesEditor). */
export function CustomFieldsEditor({ initialDefinitions }: { initialDefinitions: CustomFieldDefRow[] }) {
  const router = useRouter();
  const [defs, setDefs] = useState(initialDefinitions);
  const [drafts, setDrafts] = useState<Record<string, Fields>>(Object.fromEntries(initialDefinitions.map((d) => [d.id, fieldsOf(d)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newFields, setNewFields] = useState<Fields>(EMPTY);
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  function setDraft(id: string, patch: Partial<Fields>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function refresh() {
    const res = await fetch("/api/custom-fields");
    const j = await res.json();
    setDefs(j.definitions);
    setDrafts(Object.fromEntries((j.definitions as CustomFieldDefRow[]).map((d) => [d.id, fieldsOf(d)])));
    router.refresh();
  }

  async function save(id: string, sortOrder: number) {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/custom-fields/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toPayload(drafts[id], sortOrder)),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [id]: j.error ?? "Speichern fehlgeschlagen." }));
      setBusyId(null);
      return;
    }
    setBusyId(null);
    await refresh();
  }

  async function remove(id: string) {
    if (!confirm("Dieses Kundenfeld wirklich löschen? Bestehende Werte bleiben gespeichert, sind aber nicht mehr bearbeitbar.")) return;
    setBusyId(id);
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [id]: j.error ?? "Löschen fehlgeschlagen." }));
      setBusyId(null);
      return;
    }
    setBusyId(null);
    await refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= defs.length) return;
    const previous = defs;
    const reordered = [...defs];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setDefs(reordered);
    setReorderError(null);
    const res = await fetch("/api/custom-fields/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((d) => d.id) }),
    });
    if (res.ok) {
      await refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setDefs(previous);
    setReorderError(j.error ?? "Umsortieren fehlgeschlagen.");
  }

  async function create() {
    setCreating(true);
    setNewError(null);
    const res = await fetch("/api/custom-fields", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toPayload(newFields, defs.length)),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setNewError(j.error ?? "Anlegen fehlgeschlagen.");
      setCreating(false);
      return;
    }
    setNewFields(EMPTY);
    setCreating(false);
    await refresh();
  }

  const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      {reorderError && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{reorderError}</div>}
      <div className="space-y-3">
        {defs.map((d, i) => {
          const f = drafts[d.id];
          if (!f) return null;
          return (
            <div key={d.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-slate-300 px-1.5 py-0.5 disabled:opacity-40">
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === defs.length - 1} className="rounded border border-slate-300 px-1.5 py-0.5 disabled:opacity-40">
                  ↓
                </button>
                <span>Schlüssel: {d.key}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={input} placeholder="Bezeichnung" value={f.label} onChange={(e) => setDraft(d.id, { label: e.target.value })} />
                <select className={input} value={f.type} onChange={(e) => setDraft(d.id, { type: e.target.value as Fields["type"] })}>
                  <option value="TEXT">Text</option>
                  <option value="NUMBER">Zahl</option>
                  <option value="DATE">Datum</option>
                  <option value="BOOLEAN">Ja/Nein</option>
                  <option value="SELECT">Auswahl</option>
                </select>
                {f.type === "SELECT" && (
                  <input
                    className={`${input} sm:col-span-2`}
                    placeholder="Optionen, kommagetrennt"
                    value={f.options}
                    onChange={(e) => setDraft(d.id, { options: e.target.value })}
                  />
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.required} onChange={(e) => setDraft(d.id, { required: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  Pflichtfeld
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.isActive} onChange={(e) => setDraft(d.id, { isActive: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  Aktiv
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => save(d.id, d.sortOrder)} disabled={busyId === d.id} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  Speichern
                </button>
                <button type="button" onClick={() => remove(d.id)} disabled={busyId === d.id} className="text-xs font-medium text-rose-600 hover:underline">
                  Löschen
                </button>
                {errors[d.id] && <span className="text-xs text-rose-600">{errors[d.id]}</span>}
              </div>
            </div>
          );
        })}
        {defs.length === 0 && <p className="text-sm text-slate-500">Noch keine Kundenfelder definiert.</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Neues Kundenfeld</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className={input}
            placeholder="Schlüssel (a-z, 0-9, _)"
            value={newFields.key}
            onChange={(e) => setNewFields((f) => ({ ...f, key: e.target.value.toLowerCase() }))}
          />
          <input className={input} placeholder="Bezeichnung" value={newFields.label} onChange={(e) => setNewFields((f) => ({ ...f, label: e.target.value }))} />
          <select className={input} value={newFields.type} onChange={(e) => setNewFields((f) => ({ ...f, type: e.target.value as Fields["type"] }))}>
            <option value="TEXT">Text</option>
            <option value="NUMBER">Zahl</option>
            <option value="DATE">Datum</option>
            <option value="BOOLEAN">Ja/Nein</option>
            <option value="SELECT">Auswahl</option>
          </select>
          {newFields.type === "SELECT" && (
            <input
              className={input}
              placeholder="Optionen, kommagetrennt"
              value={newFields.options}
              onChange={(e) => setNewFields((f) => ({ ...f, options: e.target.value }))}
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newFields.required} onChange={(e) => setNewFields((f) => ({ ...f, required: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
            Pflichtfeld
          </label>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating || !newFields.key.trim() || !newFields.label.trim()}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {creating ? "…" : "Kundenfeld anlegen"}
        </button>
        {newError && <p className="mt-2 text-xs text-rose-600">{newError}</p>}
      </div>
    </div>
  );
}
