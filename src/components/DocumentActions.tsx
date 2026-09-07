"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DocType = "QUOTE" | "DELIVERY_NOTE";
type Action = "MARK_SENT" | "MARK_ACCEPTED" | "MARK_REJECTED" | "MARK_DELIVERED" | "MARK_CREATED" | "CANCEL" | "ARCHIVE" | "UNARCHIVE";

// Client-seitige Kopie der Uebergangstabellen aus src/domain/document/status.ts (dort
// nicht importierbar, weil die Datei dbInternal laedt) — steuert nur, welche Aktionen
// angeboten werden; die eigentliche Pruefung bleibt serverseitig (409 bei Verstoss).
const QUOTE_ACTIONS: Record<string, Action[]> = {
  DRAFT: ["MARK_SENT", "MARK_ACCEPTED", "MARK_REJECTED", "CANCEL"],
  SENT: ["MARK_ACCEPTED", "MARK_REJECTED", "CANCEL"],
  ACCEPTED: ["CANCEL"],
  REJECTED: [],
  EXPIRED: ["MARK_SENT", "MARK_ACCEPTED"],
  CANCELLED: [],
};
const DELIVERY_ACTIONS: Record<string, Action[]> = {
  DRAFT: ["MARK_CREATED", "CANCEL"],
  CREATED: ["MARK_SENT", "MARK_DELIVERED", "CANCEL"],
  SENT: ["MARK_DELIVERED", "CANCEL"],
  DELIVERED: ["CANCEL"],
  CANCELLED: [],
};

const ACTION_LABEL: Record<Action, string> = {
  MARK_SENT: "Als versendet markieren",
  MARK_ACCEPTED: "Annehmen",
  MARK_REJECTED: "Ablehnen",
  MARK_DELIVERED: "Als geliefert markieren",
  MARK_CREATED: "Lieferschein erstellen (Nummer vergeben)",
  CANCEL: "Stornieren",
  ARCHIVE: "Archivieren",
  UNARCHIVE: "Aus Archiv holen",
};

const btnCls = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export function DocumentActions({
  type,
  id,
  status,
  archived,
  editHref,
  onDuplicate,
}: {
  type: DocType;
  id: string;
  status: string;
  archived: boolean;
  editHref?: string;
  /** DELIVERY_NOTE ist eigenstaendig routbar (/lieferscheine/[id]); QUOTE bleibt auf /dokumente/[id]. */
  onDuplicate?: (newId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | "DUPLICATE" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteDialogRef = useRef<HTMLDialogElement>(null);
  const [pendingNoteAction, setPendingNoteAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");

  const statusRoute = type === "QUOTE" ? `/api/documents/${id}/status` : `/api/delivery-notes/${id}/status`;
  const duplicateRoute = type === "QUOTE" ? `/api/documents/${id}/duplicate` : `/api/delivery-notes/${id}/duplicate`;
  const available = (type === "QUOTE" ? QUOTE_ACTIONS[status] : DELIVERY_ACTIONS[status]) ?? [];

  async function runAction(action: Action, withNote?: string) {
    setBusy(action);
    setError(null);
    const res = await fetch(statusRoute, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: withNote || undefined }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Aktion fehlgeschlagen.");
      setBusy(null);
      return;
    }
    setBusy(null);
    router.refresh();
  }

  function openNoteDialog(action: Action) {
    setPendingNoteAction(action);
    setNote("");
    noteDialogRef.current?.showModal();
  }
  async function confirmNoteDialog() {
    if (!pendingNoteAction) return;
    noteDialogRef.current?.close();
    await runAction(pendingNoteAction, note.trim() || undefined);
    setPendingNoteAction(null);
  }

  async function duplicate() {
    setBusy("DUPLICATE");
    setError(null);
    const res = await fetch(duplicateRoute, { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Duplizieren fehlgeschlagen.");
      setBusy(null);
      return;
    }
    const j = (await res.json()) as { id: string };
    setBusy(null);
    if (onDuplicate) {
      onDuplicate(j.id);
    } else {
      router.push(type === "QUOTE" ? `/dokumente/${j.id}` : `/lieferscheine/${j.id}`);
    }
  }

  function click(action: Action) {
    if (action === "MARK_ACCEPTED" || action === "MARK_REJECTED") {
      openNoteDialog(action);
      return;
    }
    void runAction(action);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {editHref && status === "DRAFT" && (
          <a href={editHref} className={btnCls}>
            Bearbeiten
          </a>
        )}
        {available.map((a) => (
          <button key={a} type="button" onClick={() => click(a)} disabled={busy !== null} className={btnCls}>
            {busy === a ? "…" : ACTION_LABEL[a]}
          </button>
        ))}
        {!archived ? (
          <button type="button" onClick={() => click("ARCHIVE")} disabled={busy !== null} className={btnCls}>
            {busy === "ARCHIVE" ? "…" : ACTION_LABEL.ARCHIVE}
          </button>
        ) : (
          <button type="button" onClick={() => click("UNARCHIVE")} disabled={busy !== null} className={btnCls}>
            {busy === "UNARCHIVE" ? "…" : ACTION_LABEL.UNARCHIVE}
          </button>
        )}
        <button type="button" onClick={duplicate} disabled={busy !== null} className={btnCls}>
          {busy === "DUPLICATE" ? "…" : "Duplizieren"}
        </button>
      </span>
      {error && <span className="text-xs text-rose-600">{error}</span>}

      <dialog ref={noteDialogRef} className="w-full max-w-md rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40">
        <div className="p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-900">
            {pendingNoteAction === "MARK_REJECTED" ? "Ablehnen" : "Annehmen"} — Notiz (optional)
          </h2>
          <textarea
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. telefonisch zugesagt am ..."
          />
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={confirmNoteDialog} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Bestätigen
            </button>
            <button type="button" onClick={() => noteDialogRef.current?.close()} className="text-sm text-slate-500 hover:text-slate-800">
              Abbrechen
            </button>
          </div>
        </div>
      </dialog>
    </span>
  );
}
