"use client";

import { useActionState } from "react";
import { saveMailSettingsAction } from "@/app/actions/email";
import type { ActionResult } from "@/app/actions/result";
import { TextField, SelectField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";

export interface MailSettingsFormData {
  host: string;
  port: number;
  security: string;
  username: string | null;
  hasPassword: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  defaultCc: string;
  defaultBcc: string;
  copyToSelf: boolean;
}

export function MailSettingsForm({ settings }: { settings?: MailSettingsFormData | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveMailSettingsAction, { ok: false });

  return (
    <form action={action} className="space-y-6">
      <ErrorBanner message={state.error} />
      {state.ok && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">SMTP-Server</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Host" name="host" defaultValue={settings?.host} required />
          <TextField label="Port" name="port" defaultValue={String(settings?.port ?? 587)} required />
          <SelectField
            label="Sicherheit"
            name="security"
            defaultValue={settings?.security ?? "STARTTLS"}
            options={[
              { value: "STARTTLS", label: "STARTTLS" },
              { value: "TLS", label: "TLS" },
              { value: "NONE", label: "Keine" },
            ]}
          />
          <TextField label="Benutzer" name="username" defaultValue={settings?.username} />
          <TextField
            label="Passwort"
            name="password"
            type="password"
            placeholder={settings?.hasPassword ? "unverändert lassen" : undefined}
            hint={settings?.hasPassword ? "Leer lassen, um das gespeicherte Passwort beizubehalten." : undefined}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Absender & Empfänger</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Absendername" name="fromName" defaultValue={settings?.fromName} required />
          <TextField label="Absenderadresse" name="fromEmail" type="email" defaultValue={settings?.fromEmail} required />
          <TextField label="Antwort-an" name="replyTo" type="email" defaultValue={settings?.replyTo} />
          <TextField label="Standard-CC" name="defaultCc" defaultValue={settings?.defaultCc} hint="Kommagetrennt" />
          <TextField label="Standard-BCC" name="defaultBcc" defaultValue={settings?.defaultBcc} hint="Kommagetrennt" />
          <CheckboxField label="Kopie an mich" name="copyToSelf" defaultChecked={settings?.copyToSelf} hint="Absenderadresse wird jeder gesendeten Mail als BCC hinzugefügt." />
        </div>
      </section>

      <SubmitButton>Einstellungen speichern</SubmitButton>
    </form>
  );
}
