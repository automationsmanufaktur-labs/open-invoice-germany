"use client";

/**
 * Anhaenge-Panel (Phase 4b, §38): Upload (multipart, Fortschritt via Busy-Status),
 * Liste, Download (GET /api/attachments/[id]), Loeschen ueber ein <dialog>-Confirm.
 * Verwendbar auf Rechnung/Dokument/Lieferschein — docType kommt aus DocRefType.
 */
import { useRef, useState } from "react";

export interface AttachmentItem {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPanel({
  docType,
  docId,
  initial,
}: {
  docType: "QUOTE" | "INVOICE" | "RECURRING" | "DELIVERY_NOTE" | "DUNNING";
  docId: string;
  initial: AttachmentItem[];
}) {
  const [items, setItems] = useState<AttachmentItem[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttachmentItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("docType", docType);
      fd.set("docId", docId);
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Upload fehlgeschlagen.");
        return;
      }
      // 201 (alle gespeichert) oder 207 (Teilerfolg) — saved uebernehmen, failed als
      // Warnung anzeigen, statt den gesamten Mehrfach-Upload an einer fehlerhaften
      // Datei scheitern zu lassen (Fix-Runde 1).
      const saved = (j.saved ?? []) as AttachmentItem[];
      const failed = (j.failed ?? []) as { filename: string; error: string }[];
      setItems((prev) => [...prev, ...saved]);
      if (failed.length > 0) {
        setError(failed.map((f) => `${f.filename}: ${f.error}`).join(" · "));
      }
    } catch {
      setError("Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function askDelete(item: AttachmentItem) {
    setPendingDelete(item);
    dialogRef.current?.showModal();
  }
  function closeDeleteDialog() {
    dialogRef.current?.close();
    setPendingDelete(null);
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/attachments/${pendingDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((a) => a.id !== pendingDelete.id));
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Loeschen fehlgeschlagen.");
      }
    } finally {
      setDeleting(false);
      closeDeleteDialog();
    }
  }

  // Drag-and-Drop-Upload (Ruling docs/K1): dieselbe upload()-Funktion wie der Datei-
  // Dialog, nur ueber DataTransfer.files statt eines <input>. dragging steuert
  // ausschliesslich das visuelle Feedback (Rahmenfarbe), keine eigene Logik.
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (e.currentTarget === e.target) setDragging(false);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void upload(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`space-y-3 rounded-lg border p-4 transition-colors ${dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Anhänge</h2>
        <label className="cursor-pointer text-sm font-medium text-indigo-600 hover:underline">
          {uploading ? "Lädt hoch…" : "+ Datei hochladen"}
          <input ref={fileInputRef} type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void upload(e.target.files)} />
        </label>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{error}</div>}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Keine Anhänge.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <a href={`/api/attachments/${a.id}`} className="truncate text-indigo-600 hover:underline" download>
                {a.filename}
              </a>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-400">{formatSize(a.sizeBytes)}</span>
                <button type="button" onClick={() => askDelete(a)} className="text-xs font-medium text-rose-500 hover:underline">
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={dialogRef} className="rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40">
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-700">
            Anhang <span className="font-medium">{pendingDelete?.filename}</span> wirklich löschen?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeDeleteDialog} className="text-sm text-slate-500 hover:text-slate-800">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleting ? "Löscht…" : "Löschen"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
