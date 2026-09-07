"use client";

import { useActionState } from "react";
import { deleteEmailTemplateAction, setDefaultEmailTemplateAction } from "@/app/actions/templates";
import type { ActionResult } from "@/app/actions/result";
import { useFormStatus } from "react-dom";

function RowSubmitButton({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:opacity-60`}>
      {pending ? "…" : children}
    </button>
  );
}

/** Loesch- und "Als Standard"-Aktionen einer Vorlagenzeile. Zeigt Fehlermeldungen
 *  (z. B. blockierte Loeschung der letzten Standard-/Systemvorlage) inline an. */
export function TemplateRowActions({ id, isDefault }: { id: string; isDefault: boolean }) {
  const [deleteState, deleteAction] = useActionState<ActionResult, FormData>(deleteEmailTemplateAction, { ok: false });
  const [defaultState, defaultAction] = useActionState<ActionResult, FormData>(setDefaultEmailTemplateAction, { ok: false });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {!isDefault && (
          <form action={defaultAction}>
            <input type="hidden" name="id" value={id} />
            <RowSubmitButton className="text-slate-600 hover:underline">Als Standard</RowSubmitButton>
          </form>
        )}
        <form action={deleteAction}>
          <input type="hidden" name="id" value={id} />
          <RowSubmitButton className="text-rose-600 hover:underline">Löschen</RowSubmitButton>
        </form>
      </div>
      {deleteState.error && <p className="text-xs text-rose-700">{deleteState.error}</p>}
      {defaultState.error && <p className="text-xs text-rose-700">{defaultState.error}</p>}
    </div>
  );
}
