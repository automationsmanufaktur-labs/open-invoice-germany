"use client";

import { useActionState } from "react";
import { decideOfferAction } from "./actions";
import type { ActionResult } from "@/app/actions/result";

const initialState: ActionResult = { ok: false };

export function DecisionForm({ token }: { token: string }) {
  const boundAction = decideOfferAction.bind(null, token);
  const [state, action, pending] = useActionState<ActionResult, FormData>(boundAction, initialState);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Ihre Entscheidung</h2>

      {state.error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{state.error}</div>}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">
          Name <span className="text-rose-500">*</span>
        </span>
        <input name="name" required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">E-Mail</span>
        <input name="email" type="email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Kommentar</span>
        <textarea name="comment" rows={3} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="submit"
          name="decision"
          value="ACCEPTED"
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Wird gespeichert…" : "Angebot annehmen"}
        </button>
        <button
          type="submit"
          name="decision"
          value="REJECTED"
          disabled={pending}
          className="rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        >
          {pending ? "Wird gespeichert…" : "Angebot ablehnen"}
        </button>
      </div>
    </form>
  );
}
