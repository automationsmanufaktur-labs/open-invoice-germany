"use client";

import { useActionState, useState } from "react";
import { saveTextTemplateAction } from "@/app/actions/text-templates";
import type { ActionResult } from "@/app/actions/result";
import { DOC_TYPE_LABEL } from "@/lib/email/doc-type-labels";
import type { EmailDocType } from "@/schemas/email";
import { TextField, SelectField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";

const DOC_TYPES: EmailDocType[] = ["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA", "DELIVERY_NOTE", "INVOICE"];
const POSITIONS = [
  { value: "HEAD", label: "Kopftext" },
  { value: "FOOT", label: "Fußtext" },
  { value: "TERMS_DELIVERY", label: "Lieferbedingungen" },
  { value: "TERMS_PAYMENT", label: "Zahlungsbedingungen" },
] as const;

export interface TextTemplateFormData {
  id?: string;
  name: string;
  docType: EmailDocType;
  position: string;
  body: string;
  isDefault: boolean;
}

export function TextTemplateForm({ template }: { template?: TextTemplateFormData | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveTextTemplateAction, { ok: false });
  const [docType, setDocType] = useState<EmailDocType>(template?.docType ?? "ANGEBOT");
  const [body, setBody] = useState(template?.body ?? "");
  const [preview, setPreview] = useState<{ body: string; warnings: string[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  async function loadPreview() {
    setPreviewBusy(true);
    try {
      const res = await fetch("/api/emails/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType, subject: "", body, signature: "", sample: true }),
      });
      const j = await res.json();
      if (res.ok) setPreview({ body: j.body, warnings: j.warnings });
      else setPreview({ body: j.error ?? "Fehler", warnings: [] });
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
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Dokumenttyp / Position</span>
                <input
                  type="text"
                  value={`${DOC_TYPE_LABEL[docType]} — ${POSITIONS.find((p) => p.value === template.position)?.label ?? template.position}`}
                  disabled
                  readOnly
                  className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                />
                <span className="text-xs text-slate-400">Dokumenttyp und Position koennen nach dem Anlegen nicht mehr geaendert werden.</span>
              </label>
              <input type="hidden" name="docType" value={docType} />
              <input type="hidden" name="position" value={template.position} />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Dokumenttyp"
                name="docType"
                defaultValue={docType}
                options={DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] }))}
                onChange={(e) => setDocType(e.target.value as EmailDocType)}
              />
              <SelectField label="Position" name="position" defaultValue={template?.position ?? "HEAD"} options={POSITIONS.map((p) => ({ value: p.value, label: p.label }))} />
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            Text<span className="text-rose-500"> *</span>
          </span>
          <textarea
            rows={8}
            name="body"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Text mit Platzhaltern, z. B. {{document.number}}"
          />
        </label>

        <CheckboxField label="Als Standard fuer Dokumenttyp und Position verwenden" name="isDefault" defaultChecked={template?.isDefault} />

        <div className="flex items-center gap-3">
          <SubmitButton>Vorlage speichern</SubmitButton>
          <button type="button" onClick={loadPreview} disabled={previewBusy} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {previewBusy ? "…" : "Vorschau"}
          </button>
        </div>

        {preview && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <pre className="whitespace-pre-wrap font-sans text-slate-700">{preview.body}</pre>
            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{preview.warnings.join(", ")}</div>
            )}
          </div>
        )}
      </form>

      <aside className="space-y-2 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h3 className="font-semibold text-slate-900">Platzhalter (Auswahl)</h3>
        <ul className="space-y-1 text-xs text-slate-500">
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{"{{document.number}}"}</code> Belegnummer
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{"{{document.date}}"}</code> Datum
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{"{{customer.name}}"}</code> Kundenname
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{"{{offer.validUntil}}"}</code> Gültig bis (Angebot)
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{"{{company.name}}"}</code> Eigene Firma
          </li>
        </ul>
      </aside>
    </div>
  );
}
