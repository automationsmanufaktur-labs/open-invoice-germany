"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ALL_SCOPES = ["read", "write", "send", "admin"] as const;
type Scope = (typeof ALL_SCOPES)[number];

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE");
}

/**
 * Einstellungen -> API (Phase 10, Task 1): Liste der API-Schluessel + Anlegen-Dialog,
 * der das Klartext-Token EINMALIG anzeigt (danach nur noch der Praefix in der Liste).
 * Widerrufen mit Bestaetigung, analog DunningStagesEditor (Muster fuer Loeschen).
 */
export function ApiKeysManager({ initialKeys }: { initialKeys: KeyRow[] }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  function toggleScope(s: Scope) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function create() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich.");
      return;
    }
    if (scopes.length === 0) {
      setError("Mindestens ein Scope ist erforderlich.");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), scopes, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }),
    });
    setCreating(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Anlegen fehlgeschlagen.");
      return;
    }
    const j = (await res.json()) as { key: KeyRow & { token: string } };
    setNewToken(j.key.token);
    setName("");
    setScopes(["read"]);
    setExpiresAt("");
    router.refresh();
    setKeys((cur) => [{ ...j.key }, ...cur]);
  }

  async function revoke(id: string) {
    if (!confirm("Diesen API-Schluessel wirklich widerrufen? Er kann danach nicht mehr verwendet werden.")) return;
    setBusyId(id);
    const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Widerrufen fehlgeschlagen.");
      return;
    }
    setKeys((cur) => cur.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {newToken && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">Token — nur jetzt sichtbar, danach nicht mehr abrufbar:</p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-xs">{newToken}</code>
          <button type="button" onClick={() => setNewToken(null)} className="mt-2 text-xs font-medium text-amber-800 underline">
            Verstanden, ausblenden
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Buchhaltungs-Integration"
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <span className="block text-xs font-medium text-slate-600">Scopes</span>
          <div className="mt-1 flex gap-2">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Ablauf (optional)</label>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "Wird angelegt…" : "Anlegen"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2">Praefix</th>
            <th className="py-1 pr-2">Scopes</th>
            <th className="py-1 pr-2">Zuletzt genutzt</th>
            <th className="py-1 pr-2">Laeuft ab</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-b border-slate-100">
              <td className="py-1 pr-2">{k.name}</td>
              <td className="py-1 pr-2 font-mono text-xs">oig_{k.prefix}…</td>
              <td className="py-1 pr-2">{k.scopes.join(", ")}</td>
              <td className="py-1 pr-2">{fmt(k.lastUsedAt)}</td>
              <td className="py-1 pr-2">{fmt(k.expiresAt)}</td>
              <td className="py-1 pr-2">{k.revokedAt ? "widerrufen" : "aktiv"}</td>
              <td className="py-1 text-right">
                {!k.revokedAt && (
                  <button type="button" onClick={() => revoke(k.id)} disabled={busyId === k.id} className="text-xs font-medium text-red-600 underline disabled:opacity-50">
                    Widerrufen
                  </button>
                )}
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr>
              <td colSpan={7} className="py-3 text-center text-slate-400">
                Noch keine API-Schluessel.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
