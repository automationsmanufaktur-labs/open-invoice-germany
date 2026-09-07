"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { deletePaymentMethodAction } from "@/app/actions/payment-methods";
import type { ActionResult } from "@/app/actions/result";

function RowSubmitButton({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:opacity-60`}>
      {pending ? "…" : children}
    </button>
  );
}

/** Loeschen-Aktion einer Zahlungsmethoden-Zeile. Systemmethoden und Methoden, die noch
 *  von einer Rechnung/einem Kunden referenziert werden, liefern eine verstaendliche
 *  Fehlermeldung statt einer harten Ablehnung ohne Erklaerung. */
export function PaymentMethodRowActions({ id, isSystem }: { id: string; isSystem: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(deletePaymentMethodAction, { ok: false });

  if (isSystem) {
    return <span className="text-xs text-slate-400">Systemmethode</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <RowSubmitButton className="text-rose-600 hover:underline">Löschen</RowSubmitButton>
      </form>
      {state.error && <p className="text-xs text-rose-700">{state.error}</p>}
    </div>
  );
}
