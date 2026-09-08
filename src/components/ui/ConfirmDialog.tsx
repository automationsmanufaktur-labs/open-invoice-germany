"use client";

/**
 * Gemeinsame Bestaetigung fuer <dialog>-Dialoge OHNE eigenes Formular (Phase 12a).
 * Zwei per Typ-Union getrennte Varianten: `onConfirm` (Rueckruf) oder `confirmHref`
 * (next/link-Ziel, Editor "Trotzdem verlassen?"). Die Zentrierung kommt aus der
 * globalen Regel `dialog:modal { margin: auto }` — hier nicht nachgebaut.
 * Escape schliesst nativ; der Fokus landet beim Oeffnen auf "Abbrechen".
 *
 * `busy` (Task-1-Review-Nachtrag): der Aufrufer setzt dieses Prop NUR, wenn er
 * selbst ueber die Dauer eines asynchronen Vorgangs (z. B. `AttachmentPanel`s
 * Loesch-Fetch) Buch fuehrt. Ist das Prop ueberhaupt gesetzt ("busy-aware"),
 * schliesst der Bestaetigen-Klick den Dialog NICHT mehr selbst — der Aufrufer
 * ruft `close()` ueber `ConfirmDialogHandle` explizit auf, sobald der Vorgang
 * abgeschlossen ist (fruehere UX vor der ConfirmDialog-Vereinheitlichung: der
 * Dialog blieb waehrend des Loeschens offen, siehe `git show 9420a20:src/
 * components/AttachmentPanel.tsx`). Ist `busy` nicht gesetzt (z. B.
 * `EditorHeader`s "Trotzdem verlassen?"), bleibt das alte Verhalten (Klick
 * schliesst sofort) unveraendert.
 */
import Link from "next/link";
import { forwardRef, useId, useImperativeHandle, useRef, type ReactNode } from "react";

export interface ConfirmDialogHandle {
  open: () => void;
  close: () => void;
}

type ConfirmDialogProps = {
  title?: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
} & ({ onConfirm: () => void; confirmHref?: never } | { confirmHref: string; onConfirm?: never });

const TONE_CLS: Record<"default" | "danger", string> = {
  default: "bg-indigo-600 hover:bg-indigo-700",
  danger: "bg-rose-600 hover:bg-rose-700",
};

export const ConfirmDialog = forwardRef<ConfirmDialogHandle, ConfirmDialogProps>(function ConfirmDialog(
  { title, message, confirmLabel, cancelLabel = "Abbrechen", tone = "default", busy, onConfirm, confirmHref },
  ref,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  // Gesetzt (auch als `false`) => der Aufrufer verwaltet das Schliessen selbst,
  // siehe Modulkommentar oben. `undefined` => altes Verhalten.
  const busyAware = busy !== undefined;

  useImperativeHandle(ref, () => ({
    open: () => {
      dialogRef.current?.showModal();
      cancelRef.current?.focus();
    },
    close: () => dialogRef.current?.close(),
  }));

  const confirmCls = `rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${TONE_CLS[tone]}`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={title ? titleId : undefined}
      // Fix-Welle 12a (M3): ohne `title` fehlt `aria-labelledby`, und `aria-describedby`
      // allein benennt einen Dialog nicht (nur eine Beschreibung, kein Name) — beide
      // aktuellen Aufrufstellen (AttachmentPanel, EditorHeader) setzen `title` nicht.
      // Fallback auf einen generischen Accessible Name, wenn kein Titel vorhanden ist.
      aria-label={title ? undefined : "Bestätigung"}
      aria-describedby={messageId}
      className="w-full max-w-sm rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40"
    >
      <div className="space-y-3 p-5">
        {title && (
          <h2 id={titleId} className="text-sm font-semibold text-slate-900">
            {title}
          </h2>
        )}
        <p id={messageId} className="text-sm text-slate-700">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:text-slate-800">
            {cancelLabel}
          </button>
          {confirmHref ? (
            <Link href={confirmHref} className={confirmCls} onClick={() => dialogRef.current?.close()}>
              {confirmLabel}
            </Link>
          ) : (
            <button
              type="button"
              disabled={busy === true}
              className={confirmCls}
              onClick={() => {
                if (!busyAware) dialogRef.current?.close();
                onConfirm?.();
              }}
            >
              {busy === true ? `${confirmLabel}…` : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
});
