"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  isDefault: boolean;
}

interface Fields {
  firstName: string;
  lastName: string;
  role: string;
  phone: string;
  mobile: string;
  email: string;
  isDefault: boolean;
}

const EMPTY: Fields = { firstName: "", lastName: "", role: "", phone: "", mobile: "", email: "", isDefault: false };

function fieldsOf(c: ContactRow): Fields {
  return { firstName: c.firstName, lastName: c.lastName, role: c.role ?? "", phone: c.phone ?? "", mobile: c.mobile ?? "", email: c.email ?? "", isDefault: c.isDefault };
}

/** Kunden-Ansprechpartner (§30) — CRUD + kundenweiter Default. Muster: AddressesPanel. */
export function ContactsPanel({ customerId, initialContacts }: { customerId: string; initialContacts: ContactRow[] }) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initialContacts);
  const [drafts, setDrafts] = useState<Record<string, Fields>>(Object.fromEntries(initialContacts.map((c) => [c.id, fieldsOf(c)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newFields, setNewFields] = useState<Fields>(EMPTY);
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function setDraft(id: string, patch: Partial<Fields>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function refresh() {
    const res = await fetch(`/api/customers/${customerId}/contacts`);
    const j = await res.json();
    setContacts(j.contacts);
    setDrafts(Object.fromEntries((j.contacts as ContactRow[]).map((c) => [c.id, fieldsOf(c)])));
    router.refresh();
  }

  async function save(id: string) {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/customers/${customerId}/contacts/${id}`, {
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
    if (!confirm("Diesen Ansprechpartner wirklich löschen?")) return;
    setBusyId(id);
    const res = await fetch(`/api/customers/${customerId}/contacts/${id}`, { method: "DELETE" });
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
    await fetch(`/api/customers/${customerId}/contacts/${id}/default`, { method: "POST" });
    setBusyId(null);
    await refresh();
  }

  async function create() {
    setCreating(true);
    setNewError(null);
    const res = await fetch(`/api/customers/${customerId}/contacts`, {
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
        {contacts.map((c) => {
          const d = drafts[c.id];
          if (!d) return null;
          return (
            <div key={c.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                {c.isDefault && <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">Standard</span>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={input} placeholder="Vorname" value={d.firstName} onChange={(e) => setDraft(c.id, { firstName: e.target.value })} />
                <input className={input} placeholder="Nachname" value={d.lastName} onChange={(e) => setDraft(c.id, { lastName: e.target.value })} />
                <input className={input} placeholder="Rolle (optional)" value={d.role} onChange={(e) => setDraft(c.id, { role: e.target.value })} />
                <input className={input} placeholder="E-Mail" value={d.email} onChange={(e) => setDraft(c.id, { email: e.target.value })} />
                <input className={input} placeholder="Telefon" value={d.phone} onChange={(e) => setDraft(c.id, { phone: e.target.value })} />
                <input className={input} placeholder="Mobil" value={d.mobile} onChange={(e) => setDraft(c.id, { mobile: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => save(c.id)} disabled={busyId === c.id} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  Speichern
                </button>
                {!c.isDefault && (
                  <button type="button" onClick={() => makeDefault(c.id)} disabled={busyId === c.id} className="text-xs font-medium text-indigo-600 hover:underline">
                    Als Standard setzen
                  </button>
                )}
                <button type="button" onClick={() => remove(c.id)} disabled={busyId === c.id} className="text-xs font-medium text-rose-600 hover:underline">
                  Löschen
                </button>
                {errors[c.id] && <span className="text-xs text-rose-600">{errors[c.id]}</span>}
              </div>
            </div>
          );
        })}
        {contacts.length === 0 && <p className="text-sm text-slate-500">Noch keine Ansprechpartner.</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Neuer Ansprechpartner</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="Vorname" value={newFields.firstName} onChange={(e) => setNewFields((f) => ({ ...f, firstName: e.target.value }))} />
          <input className={input} placeholder="Nachname" value={newFields.lastName} onChange={(e) => setNewFields((f) => ({ ...f, lastName: e.target.value }))} />
          <input className={input} placeholder="Rolle (optional)" value={newFields.role} onChange={(e) => setNewFields((f) => ({ ...f, role: e.target.value }))} />
          <input className={input} placeholder="E-Mail" value={newFields.email} onChange={(e) => setNewFields((f) => ({ ...f, email: e.target.value }))} />
          <input className={input} placeholder="Telefon" value={newFields.phone} onChange={(e) => setNewFields((f) => ({ ...f, phone: e.target.value }))} />
          <input className={input} placeholder="Mobil" value={newFields.mobile} onChange={(e) => setNewFields((f) => ({ ...f, mobile: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newFields.isDefault} onChange={(e) => setNewFields((f) => ({ ...f, isDefault: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
            als Standard setzen
          </label>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating || !newFields.firstName.trim() || !newFields.lastName.trim()}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {creating ? "…" : "Ansprechpartner anlegen"}
        </button>
        {newError && <p className="mt-2 text-xs text-rose-600">{newError}</p>}
      </div>
    </div>
  );
}
