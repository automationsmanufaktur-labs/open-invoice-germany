"use client";

import { ACTION_LABEL, NoteDialog, documentActionItemCls, useDocumentActions, type DocType } from "@/components/DocumentActions";

/**
 * Menuezeilen-Gegenstueck zu `DocumentActions` `variant="compact"` (Phase 11d, Fix-Welle I2):
 * die restlichen Statusuebergaenge (ab dem zweiten) sowie Archivieren/Aus Archiv und
 * Duplizieren, als volle Zeilen fuer ein `<ActionMenu>` (`<li className="contents">` haelt
 * den Notiz-Dialog HTML-gueltig innerhalb der `<ul>`, ohne einen sichtbaren Menuepunkt zu
 * belegen). Aufrufer: `/dokumente/[id]` und `/lieferscheine/[id]`, jeweils als erste Kinder
 * des gemeinsamen `<ActionMenu>` im `more`-Slot.
 */
export function DocumentActionsMenuItems({
  type,
  id,
  status,
  archived,
  onDuplicate,
}: {
  type: DocType;
  id: string;
  status: string;
  archived: boolean;
  onDuplicate?: (newId: string) => void;
}) {
  const { available, busy, error, noteDialogRef, pendingNoteAction, note, setNote, click, duplicate, confirmNoteDialog } = useDocumentActions({
    type,
    id,
    status,
    onDuplicate,
  });
  const remaining = available.slice(1);

  return (
    <>
      {remaining.map((a) => (
        <li key={a}>
          <button type="button" onClick={() => click(a)} disabled={busy !== null} className={documentActionItemCls}>
            {busy === a ? "…" : ACTION_LABEL[a]}
          </button>
        </li>
      ))}
      <li>
        {!archived ? (
          <button type="button" onClick={() => click("ARCHIVE")} disabled={busy !== null} className={documentActionItemCls}>
            {busy === "ARCHIVE" ? "…" : ACTION_LABEL.ARCHIVE}
          </button>
        ) : (
          <button type="button" onClick={() => click("UNARCHIVE")} disabled={busy !== null} className={documentActionItemCls}>
            {busy === "UNARCHIVE" ? "…" : ACTION_LABEL.UNARCHIVE}
          </button>
        )}
      </li>
      <li>
        <button type="button" onClick={duplicate} disabled={busy !== null} className={documentActionItemCls}>
          {busy === "DUPLICATE" ? "…" : "Duplizieren"}
        </button>
      </li>
      {error && <li className="px-3 py-1 text-xs text-rose-600">{error}</li>}
      <li className="contents">
        <NoteDialog dialogRef={noteDialogRef} pendingNoteAction={pendingNoteAction} note={note} setNote={setNote} onConfirm={confirmNoteDialog} />
      </li>
    </>
  );
}
