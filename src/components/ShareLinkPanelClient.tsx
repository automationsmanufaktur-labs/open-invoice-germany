"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface ShareLinkRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  decidedAt: string | null;
  decision: string | null;
  deciderName: string | null;
}

function deDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function statusLabel(l: ShareLinkRow): string {
  if (l.revokedAt) return "Widerrufen";
  if (l.decidedAt) return l.decision === "ACCEPTED" ? "Angenommen" : "Abgelehnt";
  if (new Date(l.expiresAt).getTime() < Date.now()) return "Abgelaufen";
  return "Aktiv";
}

/** Interaktiver Teil des Annahme-Link-Panels: erzeugen, kopieren, widerrufen. */
export function ShareLinkPanelClient({ documentId, initialLinks }: { documentId: string; initialLinks: ShareLinkRow[] }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealing, setRevealing] = useState<string | null>(null);

  async function createLink() {
    setCreating(true);
    setError(null);
    setNewUrl(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/documents/${documentId}/share-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Link konnte nicht erzeugt werden.");
        return;
      }
      setNewUrl(j.url);
      dialogRef.current?.showModal();
      router.refresh();
    } catch {
      setError("Link konnte nicht erzeugt werden.");
    } finally {
      setCreating(false);
    }
  }

  /** Adjudikation Task-1: Klartext-URL eines bestehenden Links ueber die Betreiber-Route abrufen (statt neu zu minten). */
  async function reveal(id: string) {
    setRevealing(id);
    setError(null);
    setNewUrl(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/documents/${documentId}/share-links/${id}/token`);
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Link konnte nicht angezeigt werden.");
        return;
      }
      setNewUrl(j.url);
      dialogRef.current?.showModal();
    } catch {
      setError("Link konnte nicht angezeigt werden.");
    } finally {
      setRevealing(null);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Diesen Link wirklich widerrufen? Er kann danach nicht mehr geöffnet werden.")) return;
    await fetch(`/api/documents/${documentId}/share-links/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function copy() {
    if (!newUrl) return;
    try {
      await navigator.clipboard.writeText(newUrl);
      setCopied(true);
    } catch {
      inputRef.current?.select();
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Annahme-Link</h2>
        <button
          type="button"
          onClick={createLink}
          disabled={creating}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {creating ? "Erzeuge…" : "Link erzeugen"}
        </button>
      </div>

      {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {initialLinks.length === 0 ? (
        <p className="text-slate-500">Noch kein Link erzeugt.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2">Erstellt</th>
              <th className="py-1 pr-2">Läuft ab</th>
              <th className="py-1 pr-2">Aufrufe</th>
              <th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2">Entscheider</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initialLinks.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5 pr-2 text-slate-600">{deDateTime(l.createdAt)}</td>
                <td className="py-1.5 pr-2 text-slate-600">{deDateTime(l.expiresAt)}</td>
                <td className="tabular py-1.5 pr-2 text-slate-600">{l.viewCount}</td>
                <td className="py-1.5 pr-2 text-slate-600">{statusLabel(l)}</td>
                <td className="py-1.5 pr-2 text-slate-600">{l.deciderName ?? "—"}</td>
                <td className="py-1.5 text-right space-x-3">
                  {statusLabel(l) === "Aktiv" && (
                    <button
                      type="button"
                      onClick={() => reveal(l.id)}
                      disabled={revealing === l.id}
                      className="text-indigo-600 hover:underline disabled:opacity-60"
                    >
                      {revealing === l.id ? "Lade…" : "Link anzeigen"}
                    </button>
                  )}
                  {!l.revokedAt && !l.decidedAt && (
                    <button type="button" onClick={() => revoke(l.id)} className="text-rose-600 hover:underline">
                      Widerrufen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dialog ref={dialogRef} className="w-full max-w-lg rounded-lg border border-slate-200 p-5 backdrop:bg-slate-900/40">
        <h3 className="mb-2 font-semibold text-slate-900">Annahme-Link</h3>
        <p className="mb-3 text-sm text-slate-600">
          Solange der Link gültig ist, kann er hier jederzeit erneut angezeigt werden (Klartext-Token verschlüsselt gespeichert).
        </p>
        <div className="mb-3 flex items-center gap-2">
          <input
            ref={inputRef}
            readOnly
            value={newUrl ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={copy} className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {copied ? "Kopiert" : "Kopieren"}
          </button>
        </div>
        <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Schließen
        </button>
      </dialog>
    </div>
  );
}
