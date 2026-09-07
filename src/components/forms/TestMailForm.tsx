"use client";

import { useActionState } from "react";
import { sendTestMailAction } from "@/app/actions/email";
import type { ActionResult } from "@/app/actions/result";
import { SubmitButton, ErrorBanner } from "./fields";

export function TestMailForm() {
  const [state, action] = useActionState<ActionResult, FormData>(sendTestMailAction, { ok: false });

  return (
    <form action={action} className="space-y-2 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Testmail</h2>
      <p className="text-sm text-slate-600">Sendet eine Testnachricht mit den aktuell gespeicherten Einstellungen.</p>
      <ErrorBanner message={state.error} />
      {state.ok && <p className="text-sm text-emerald-700">Testmail erfolgreich gesendet.</p>}
      <SubmitButton>Testmail senden</SubmitButton>
    </form>
  );
}
