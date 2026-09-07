"use client";

import { useActionState } from "react";
import { saveDocumentSettingsAction } from "@/app/actions/document-settings";
import type { ActionResult } from "@/app/actions/result";
import { SelectField, TextField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";
import type { DocumentSettingsInput } from "@/schemas";

export function DocumentSettingsForm({ settings }: { settings: DocumentSettingsInput }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveDocumentSettingsAction, { ok: false });

  return (
    <form action={action} className="space-y-6">
      <ErrorBanner message={state.error} />
      {state.ok && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Online-Angebotsannahme</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Automatik nach Online-Annahme"
            name="onQuoteAccept"
            defaultValue={settings.onQuoteAccept}
            options={[
              { value: "NONE", label: "Keine — nur Status auf ACCEPTED setzen" },
              { value: "ORDER_CONFIRMATION", label: "Auftragsbestätigung automatisch erzeugen" },
              { value: "INVOICE", label: "Rechnungsentwurf automatisch erzeugen" },
            ]}
          />
          <TextField
            label="Gültigkeitsdauer neuer Links (Tage)"
            name="shareLinkDays"
            defaultValue={String(settings.shareLinkDays)}
            hint="Kann je Link beim Erzeugen überschrieben werden; nie länger als die Angebotsgültigkeit."
          />
        </div>
        <CheckboxField
          label="IP-Adresse des Entscheiders speichern"
          name="storeAcceptIp"
          defaultChecked={settings.storeAcceptIp}
          hint="Datenschutzhinweis: Die IP-Adresse wird nur bei aktivierter Option zusammen mit Name/E-Mail/Kommentar der Online-Entscheidung gespeichert und erscheint nie im Audit-Verlauf (ChangeLog)."
        />
      </section>

      <SubmitButton>Einstellungen speichern</SubmitButton>
    </form>
  );
}
