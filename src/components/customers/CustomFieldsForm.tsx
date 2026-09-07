"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CustomFieldDefRow {
  id: string;
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
  options: string[] | null;
  required: boolean;
}

/**
 * Werte-Formular fuer die benutzerdefinierten Kundenfelder EINES Kunden (§31). Die
 * Definitionen selbst werden org-weit unter /einstellungen/kundenfelder gepflegt
 * (CustomFieldsEditor) — hier nur Werte je Feldtyp erfassen und per PUT speichern.
 */
export function CustomFieldsForm({
  customerId,
  definitions,
  initialValues,
}: {
  customerId: string;
  definitions: CustomFieldDefRow[];
  initialValues: Record<string, unknown>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const def of definitions) {
      const v = initialValues[def.key];
      if (def.type === "BOOLEAN") init[def.key] = typeof v === "boolean" ? v : false;
      else init[def.key] = v != null ? String(v) : "";
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setValue(key: string, v: string | boolean) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: Record<string, unknown> = {};
    for (const def of definitions) {
      const v = values[def.key];
      if (def.type === "BOOLEAN") {
        body[def.key] = Boolean(v);
      } else if (typeof v === "string" && v !== "") {
        body[def.key] = v;
      }
      // leere optionale Felder werden weggelassen (nicht gesetzt); required-Felder
      // schlagen serverseitig fehl, wenn sie fehlen.
    }
    const res = await fetch(`/api/customers/${customerId}/custom-fields`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  if (definitions.length === 0) {
    return <p className="text-sm text-slate-500">Noch keine Kundenfelder definiert (siehe Einstellungen → Kundenfelder).</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        {definitions.map((def) => (
          <label key={def.id} className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {def.label}
              {def.required && <span className="text-rose-500"> *</span>}
            </span>
            {def.type === "BOOLEAN" ? (
              <input
                type="checkbox"
                checked={Boolean(values[def.key])}
                onChange={(e) => setValue(def.key, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
            ) : def.type === "SELECT" ? (
              <select className={input} value={String(values[def.key] ?? "")} onChange={(e) => setValue(def.key, e.target.value)}>
                <option value="">— keine —</option>
                {(def.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : def.type === "DATE" ? (
              <input type="date" className={input} value={String(values[def.key] ?? "")} onChange={(e) => setValue(def.key, e.target.value)} />
            ) : (
              <input
                className={input}
                inputMode={def.type === "NUMBER" ? "decimal" : "text"}
                value={String(values[def.key] ?? "")}
                onChange={(e) => setValue(def.key, e.target.value)}
                placeholder={def.type === "NUMBER" ? "z. B. 12.3400" : ""}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : "Kundenfelder speichern"}
        </button>
        {saved && <span className="text-xs text-emerald-700">Gespeichert.</span>}
      </div>
    </form>
  );
}
