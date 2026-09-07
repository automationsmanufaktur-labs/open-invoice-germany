"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Pausiert den Mahnprozess einer Rechnung bis zu einem Datum (mit optionaler Notiz) —
 * POST /api/invoices/[id]/dunning-state, state=PAUSED. Task 4 (Facts): Dialog Datum+Notiz.
 *
 * S1 (Fix-Welle): pausedUntil ist am Schema jetzt Pflicht und muss in der Zukunft liegen
 * — Default +14 Tage (statt "heute", das beim naechsten Scheduler-Lauf sofort wieder
 * abgelaufen gewesen waere) und `min` = morgen, damit der Dialog kein ungueltiges Datum
 * mehr vorschlagen kann.
 */
export function PauseDialog({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pausedUntil, setPausedUntil] = useState(isoInDays(14));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/dunning-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "PAUSED", pausedUntil, note: note.trim() || undefined }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Pausieren fehlgeschlagen.");
      setBusy(false);
      return;
    }
    dialogRef.current?.close();
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Pausieren
      </button>
      <dialog ref={dialogRef} className="w-full max-w-sm rounded-lg border border-slate-200 p-5 backdrop:bg-slate-900/40">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Mahnprozess pausieren</h2>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Pausiert bis</span>
            <input type="date" min={isoInDays(1)} value={pausedUntil} onChange={(e) => setPausedUntil(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Notiz</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="z. B. Ratenzahlung vereinbart" />
          </label>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={submit} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy ? "…" : "Pausieren"}
            </button>
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:text-slate-800">
              Abbrechen
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
