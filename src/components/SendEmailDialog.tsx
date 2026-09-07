"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailDocType } from "@/schemas/email";

interface PrefillResult {
  docType: EmailDocType;
  docId: string;
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  signature: string;
  copyToSelf: boolean;
  attachments: { filename: string; size: number }[];
  // eInvoiceDefault (Phase 7, §33): Dateinamen, die beim Oeffnen vorausgewaehlt sind.
  defaultStandardAttachments: string[];
  // Beleganhaenge (Phase 4b) — zusaetzlich zu den Standardanhaengen waehlbar, per
  // attachmentIds im Payload (src/schemas/email.ts, sendEmailInputSchema.attachmentIds).
  documentAttachments: { id: string; filename: string; sizeBytes: number }[];
  warnings: string[];
  templateId?: string;
  resendOfId?: string;
  templates: { id: string; name: string }[];
}

function join(list: string[]): string {
  return list.join(", ");
}
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function SendEmailDialog({ docType, docId, label, resendLogId }: { docType: EmailDocType; docId: string; label?: string; resendLogId?: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [loading, setLoading] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<PrefillResult | null>(null);

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState("");
  const [copyToSelf, setCopyToSelf] = useState(false);
  const [selectedStandard, setSelectedStandard] = useState<Set<string>>(new Set());
  const [selectedDocAttachments, setSelectedDocAttachments] = useState<Set<string>>(new Set());
  const [extraFiles, setExtraFiles] = useState<File[]>([]);

  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function applyPrefill(pre: PrefillResult) {
    setData(pre);
    setTo(join(pre.to));
    setCc(join(pre.cc));
    setBcc(join(pre.bcc));
    setTemplateId(pre.templateId ?? "");
    setSubject(pre.subject);
    setBody(pre.body);
    setSignature(pre.signature);
    setCopyToSelf(pre.copyToSelf);
    setSelectedStandard(new Set(pre.defaultStandardAttachments));
    setSelectedDocAttachments(new Set());
    setPreview(null);
  }

  async function loadPrefill(withTemplateId?: string) {
    setLoading(true);
    setLoadError(null);
    setNotConfigured(false);
    try {
      const params = new URLSearchParams();
      if (resendLogId && !withTemplateId) {
        params.set("logId", resendLogId);
      } else {
        params.set("docType", docType);
        params.set("docId", docId);
        if (withTemplateId) params.set("templateId", withTemplateId);
      }
      const res = await fetch(`/api/emails/prefill?${params.toString()}`);
      const j = await res.json();
      if (res.status === 409) {
        setNotConfigured(true);
        return;
      }
      if (!res.ok) {
        setLoadError(j.error ?? "Vorbelegung fehlgeschlagen.");
        return;
      }
      applyPrefill(j);
    } catch {
      setLoadError("Vorbelegung fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function open() {
    dialogRef.current?.showModal();
    setSendError(null);
    await loadPrefill();
  }

  function close() {
    dialogRef.current?.close();
  }

  function onTemplateChange(id: string) {
    setTemplateId(id);
    void loadPrefill(id || undefined);
  }

  function toggleStandard(filename: string) {
    setSelectedStandard((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  function toggleDocAttachment(id: string) {
    setSelectedDocAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doPreview() {
    const res = await fetch("/api/emails/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ docType, docId, subject, body, signature }),
    });
    const j = await res.json();
    if (res.ok) setPreview(j);
    else setSendError(j.error ?? "Vorschau fehlgeschlagen.");
  }

  async function doSend() {
    setSendBusy(true);
    setSendError(null);
    try {
      const payload = {
        docType,
        docId,
        // addressListSchema erwartet den rohen, kommagetrennten Text (nicht das Array).
        to,
        cc,
        bcc,
        subject,
        body,
        signature,
        copyToSelf,
        standardAttachments: Array.from(selectedStandard),
        attachmentIds: Array.from(selectedDocAttachments),
        templateId: templateId || undefined,
        resendOfId: resendLogId,
        // Warnungen aus der Vorbelegung (z. B. unbekannte Platzhalter) mitschicken, damit
        // sie im EmailLog protokolliert werden (G3).
        warnings: data?.warnings ?? [],
      };
      const fd = new FormData();
      fd.set("payload", JSON.stringify(payload));
      for (const f of extraFiles) fd.append("files", f);

      const res = await fetch("/api/emails/send", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        if (j.error === "MAIL_NOT_CONFIGURED") setNotConfigured(true);
        else setSendError(j.error ?? "Versand fehlgeschlagen.");
        return;
      }
      if (j.status === "FAILED") {
        setSendError(j.error ?? "Versand fehlgeschlagen.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setSendError("Versand fehlgeschlagen.");
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {label ?? "Per E-Mail senden"}
      </button>

      <dialog ref={dialogRef} className="w-full max-w-2xl rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40">
        <div className="max-h-[85vh] overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">{resendLogId ? "E-Mail erneut senden" : "E-Mail senden"}</h2>
            <button type="button" onClick={close} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>

          {loading && <p className="text-sm text-slate-500">Lade Vorbelegung…</p>}

          {notConfigured && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Für diese Organisation sind keine Mail-Einstellungen hinterlegt.{" "}
              <a href="/einstellungen/email" className="font-medium underline">
                Jetzt einrichten
              </a>
            </div>
          )}

          {loadError && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{loadError}</div>}

          {data && !notConfigured && (
            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Von</span>
                <input readOnly value={`${data.from.name} <${data.from.address}>`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">An</span>
                <input value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">CC</span>
                  <input value={cc} onChange={(e) => setCc(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">BCC</span>
                  <input value={bcc} onChange={(e) => setBcc(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>

              {data.templates.length > 0 && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Vorlage</span>
                  <select value={templateId} onChange={(e) => onTemplateChange(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="">— keine —</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Betreff</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Nachricht</span>
                <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Signatur</span>
                <textarea rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>

              {data.attachments.length > 0 && (
                <div className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Standardanhänge</span>
                  {data.attachments.map((a) => (
                    <label key={a.filename} className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedStandard.has(a.filename)} onChange={() => toggleStandard(a.filename)} className="h-4 w-4 rounded border-slate-300" />
                      <span>
                        {a.filename} <span className="text-xs text-slate-400">({formatKb(a.size)})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {data.documentAttachments.length > 0 && (
                <div className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Beleganhänge</span>
                  {data.documentAttachments.map((a) => (
                    <label key={a.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedDocAttachments.has(a.id)}
                        onChange={() => toggleDocAttachment(a.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>
                        {a.filename} <span className="text-xs text-slate-400">({formatKb(a.sizeBytes)})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Zusatzdateien</span>
                <input type="file" multiple onChange={(e) => setExtraFiles(Array.from(e.target.files ?? []))} className="text-sm" />
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={copyToSelf} onChange={(e) => setCopyToSelf(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                <span className="font-medium text-slate-700">Kopie an mich</span>
              </label>

              {data.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{data.warnings.join(", ")}</div>
              )}

              {preview && (
                <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-800">Betreff: {preview.subject}</p>
                  <pre className="whitespace-pre-wrap font-sans text-slate-700">{preview.body}</pre>
                </div>
              )}

              {sendError && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{sendError}</div>}

              <div className="flex items-center gap-3 pt-2">
                <button type="button" onClick={doPreview} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Vorschau
                </button>
                <button type="button" onClick={doSend} disabled={sendBusy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  {sendBusy ? "Sende…" : "Senden"}
                </button>
                <button type="button" onClick={close} className="text-sm text-slate-500 hover:text-slate-800">
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
