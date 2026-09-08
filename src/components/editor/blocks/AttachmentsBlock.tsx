"use client";

/**
 * Anhaenge-Block (Phase 11c, Task 4): `AttachmentPanel` (bestehend) nur bei Bearbeiten
 * (braucht eine `docId`) — bei Neuanlage nur ein Hinweis, da der Upload einen bereits
 * gespeicherten Beleg voraussetzt (`docId`/`orgId`-Zuordnung serverseitig).
 *
 * `AttachmentPanel.docType` kennt keine eigene DOCUMENT-Unterscheidung nach Art
 * (Angebot/Auftragsbestaetigung/Proforma) — alle drei haengen wie heute
 * (`src/app/dokumente/[id]/page.tsx`) unter `"QUOTE"`.
 */
import type { EditorMode } from "@/lib/editor/constants";
import { AttachmentPanel, type AttachmentItem } from "@/components/AttachmentPanel";

const DOC_TYPE: Record<EditorMode, "QUOTE" | "INVOICE" | "DELIVERY_NOTE"> = {
  INVOICE: "INVOICE",
  DOCUMENT: "QUOTE",
  DELIVERY_NOTE: "DELIVERY_NOTE",
};

export function AttachmentsBlock({ mode, isEdit, docId, attachments = [] }: { mode: EditorMode; isEdit: boolean; docId?: string; attachments?: AttachmentItem[] }) {
  if (isEdit && docId) {
    return <AttachmentPanel docType={DOC_TYPE[mode]} docId={docId} initial={attachments} />;
  }
  return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Anhänge lassen sich nach dem Speichern hinzufügen.</div>;
}
