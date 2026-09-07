"use client";

import { useActionState, useState } from "react";
import { saveEmailTemplateAction } from "@/app/actions/templates";
import type { ActionResult } from "@/app/actions/result";
import { EMAIL_DOC_TYPES, type EmailDocType } from "@/schemas/email";
import { DOC_TYPE_LABEL } from "@/lib/email/doc-type-labels";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/template/placeholders";
import { TextField, SelectField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";

export interface EmailTemplateFormData {
  id?: string;
  name: string;
  docType: EmailDocType;
  subject: string;
  body: string;
  signature: string | null;
  isDefault: boolean;
}

export function EmailTemplateForm({ template }: { template?: EmailTemplateFormData | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveEmailTemplateAction, { ok: false });
  const [docType, setDocType] = useState<EmailDocType>(template?.docType ?? "INVOICE");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [signature, setSignature] = useState(template?.signature ?? "");
  const [preview, setPreview] = useState<{ subject: string; body: string; warnings: string[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  async function loadPreview() {
    setPreviewBusy(true);
    try {
      const res = await fetch("/api/emails/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType, subject, body, signature, sample: true }),
      });
      const j = await res.json();
      if (res.ok) setPreview(j);
      else setPreview({ subject: "", body: j.error ?? "Fehler", warnings: [] });
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
        <ErrorBanner message={state.error} />
        {state.ok && <p className="text-sm text-emerald-700">Vorlage gespeichert.</p>}
        {template?.id && <input type="hidden" name="id" value={template.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" name="name" defaultValue={template?.name} required />
          {template?.id ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Dokumenttyp</span>
              <input
                type="text"
                value={DOC_TYPE_LABEL[docType]}
                disabled
                readOnly
                className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-500"
              />
              <input type="hidden" name="docType" value={docType} />
              <span className="text-xs text-slate-400">Der Dokumenttyp kann nach dem Anlegen nicht mehr geändert werden.</span>
            </label>
          ) : (
            <SelectField
              label="Dokumenttyp"
              name="docType"
              defaultValue={docType}
              options={EMAIL_DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] }))}
              onChange={(e) => setDocType(e.target.value as EmailDocType)}
            />
          )}
        </div>

        <TextField label="Betreff" name="subject" defaultValue={subject} required onChange={(e) => setSubject(e.target.value)} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            Nachricht<span className="text-rose-500"> *</span>
          </span>
          <textarea
            rows={12}
            name="body"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Nachrichtentext mit Platzhaltern, z. B. {{document.number}}"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Signatur</span>
          <textarea
            rows={3}
            name="signature"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
        </label>

        <CheckboxField label="Als Standard für diesen Dokumenttyp verwenden" name="isDefault" defaultChecked={template?.isDefault} />

        <div className="flex items-center gap-3">
          <SubmitButton>Vorlage speichern</SubmitButton>
          <button type="button" onClick={loadPreview} disabled={previewBusy} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {previewBusy ? "…" : "Vorschau"}
          </button>
        </div>

        {preview && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">Betreff: {preview.subject}</p>
            <pre className="whitespace-pre-wrap font-sans text-slate-700">{preview.body}</pre>
            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                {preview.warnings.join(", ")}
              </div>
            )}
          </div>
        )}
      </form>

      <aside className="space-y-2 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h3 className="font-semibold text-slate-900">Platzhalter</h3>
        <ul className="space-y-1">
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <li key={p.path} className="flex items-center justify-between gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{`{{${p.path}}}`}</code>
              <span className="text-xs text-slate-500">{p.label}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
