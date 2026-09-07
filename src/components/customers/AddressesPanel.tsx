"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AddressRow {
  id: string;
  type: "BILLING" | "SHIPPING" | "OTHER";
  label: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  isDefault: boolean;
}

interface Fields {
  type: AddressRow["type"];
  label: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  countryCode: string;
  isDefault: boolean;
}

const EMPTY: Fields = { type: "BILLING", label: "", addressLine1: "", addressLine2: "", postalCode: "", city: "", countryCode: "DE", isDefault: false };

function fieldsOf(a: AddressRow): Fields {
  return { type: a.type, label: a.label ?? "", addressLine1: a.addressLine1, addressLine2: a.addressLine2 ?? "", postalCode: a.postalCode, city: a.city, countryCode: a.countryCode, isDefault: a.isDefault };
}

const TYPE_LABEL: Record<AddressRow["type"], string> = { BILLING: "Rechnung", SHIPPING: "Lieferung", OTHER: "Sonstige" };

/** Kunden-Zusatzadressen (§29) — CRUD + Default je Typ. Muster: DunningStagesEditor. */
export function AddressesPanel({ customerId, initialAddresses }: { customerId: string; initialAddresses: AddressRow[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [drafts, setDrafts] = useState<Record<string, Fields>>(Object.fromEntries(initialAddresses.map((a) => [a.id, fieldsOf(a)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newFields, setNewFields] = useState<Fields>(EMPTY);
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function setDraft(id: string, patch: Partial<Fields>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function refresh() {
    const res = await fetch(`/api/customers/${customerId}/addresses`);
    const j = await res.json();
    setAddresses(j.addresses);
    setDrafts(Object.fromEntries((j.addresses as AddressRow[]).map((a) => [a.id, fieldsOf(a)])));
    router.refresh();
  }

  async function save(id: string) {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/customers/${customerId}/addresses/${id}`, {
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
    await refresh();
  }

  async function remove(id: string) {
    if (!confirm("Diese Adresse wirklich löschen?")) return;
    setBusyId(id);
    const res = await fetch(`/api/customers/${customerId}/addresses/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [id]: j.error ?? "Löschen fehlgeschlagen." }));
      setBusyId(null);
      return;
    }
    setBusyId(null);
    await refresh();
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    await fetch(`/api/customers/${customerId}/addresses/${id}/default`, { method: "POST" });
    setBusyId(null);
    await refresh();
  }

  async function create() {
    setCreating(true);
    setNewError(null);
    const res = await fetch(`/api/customers/${customerId}/addresses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newFields),
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
      <div className="space-y-3">
        {addresses.map((a) => {
          const d = drafts[a.id];
          if (!d) return null;
          return (
            <div key={a.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select className={input} value={d.type} onChange={(e) => setDraft(a.id, { type: e.target.value as AddressRow["type"] })}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input className={input} placeholder="Bezeichnung (optional)" value={d.label} onChange={(e) => setDraft(a.id, { label: e.target.value })} />
                {a.isDefault && <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">Standard ({TYPE_LABEL[a.type]})</span>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={input} placeholder="Straße & Nr." value={d.addressLine1} onChange={(e) => setDraft(a.id, { addressLine1: e.target.value })} />
                <input className={input} placeholder="Adresszusatz" value={d.addressLine2} onChange={(e) => setDraft(a.id, { addressLine2: e.target.value })} />
                <input className={input} placeholder="PLZ" value={d.postalCode} onChange={(e) => setDraft(a.id, { postalCode: e.target.value })} />
                <input className={input} placeholder="Ort" value={d.city} onChange={(e) => setDraft(a.id, { city: e.target.value })} />
                <input className={input} placeholder="Land (ISO-2)" value={d.countryCode} onChange={(e) => setDraft(a.id, { countryCode: e.target.value.toUpperCase() })} />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => save(a.id)} disabled={busyId === a.id} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  Speichern
                </button>
                {!a.isDefault && (
                  <button type="button" onClick={() => makeDefault(a.id)} disabled={busyId === a.id} className="text-xs font-medium text-indigo-600 hover:underline">
                    Als Standard setzen
                  </button>
                )}
                <button type="button" onClick={() => remove(a.id)} disabled={busyId === a.id} className="text-xs font-medium text-rose-600 hover:underline">
                  Löschen
                </button>
                {errors[a.id] && <span className="text-xs text-rose-600">{errors[a.id]}</span>}
              </div>
            </div>
          );
        })}
        {addresses.length === 0 && <p className="text-sm text-slate-500">Noch keine Zusatzadressen.</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Neue Adresse</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={input} value={newFields.type} onChange={(e) => setNewFields((f) => ({ ...f, type: e.target.value as AddressRow["type"] }))}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input className={input} placeholder="Bezeichnung (optional)" value={newFields.label} onChange={(e) => setNewFields((f) => ({ ...f, label: e.target.value }))} />
          <input className={input} placeholder="Straße & Nr." value={newFields.addressLine1} onChange={(e) => setNewFields((f) => ({ ...f, addressLine1: e.target.value }))} />
          <input className={input} placeholder="Adresszusatz" value={newFields.addressLine2} onChange={(e) => setNewFields((f) => ({ ...f, addressLine2: e.target.value }))} />
          <input className={input} placeholder="PLZ" value={newFields.postalCode} onChange={(e) => setNewFields((f) => ({ ...f, postalCode: e.target.value }))} />
          <input className={input} placeholder="Ort" value={newFields.city} onChange={(e) => setNewFields((f) => ({ ...f, city: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newFields.isDefault} onChange={(e) => setNewFields((f) => ({ ...f, isDefault: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
            als Standard setzen
          </label>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating || !newFields.addressLine1.trim() || !newFields.postalCode.trim() || !newFields.city.trim()}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {creating ? "…" : "Adresse anlegen"}
        </button>
        {newError && <p className="mt-2 text-xs text-rose-600">{newError}</p>}
      </div>
    </div>
  );
}
