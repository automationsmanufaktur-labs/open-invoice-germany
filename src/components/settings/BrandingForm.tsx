"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BrandingSettingsInput } from "@/schemas";

const PREVIEW_DOC_TYPES: { value: string; label: string }[] = [
  { value: "INVOICE", label: "Rechnung" },
  { value: "ANGEBOT", label: "Angebot" },
  { value: "DELIVERY_NOTE", label: "Lieferschein" },
];

/** Briefpapier-Einstellungen (§35): Logo-/Hintergrund-Upload, Farbe, Ränder, Fußzeilen, Live-Vorschau als PDF. */
export function BrandingForm({ initial }: { initial: BrandingSettingsInput }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "background" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [previewDocType, setPreviewDocType] = useState("INVOICE");

  function setField<K extends keyof BrandingSettingsInput>(key: K, value: BrandingSettingsInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string };
    if (!res.ok || !j.settings) {
      setError(j.error ?? "Speichern fehlgeschlagen.");
      setSaving(false);
      return;
    }
    setValues(j.settings);
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  async function upload(kind: "logo" | "background", file: File) {
    setUploading(kind);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/settings/branding/upload?kind=${kind}`, { method: "POST", body: fd });
    const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string };
    if (!res.ok || !j.settings) {
      setError(j.error ?? "Hochladen fehlgeschlagen.");
      setUploading(null);
      return;
    }
    setValues(j.settings);
    setUploading(null);
    router.refresh();
  }

  async function removeFile(kind: "logo" | "background") {
    setError(null);
    const res = await fetch(`/api/settings/branding/upload?kind=${kind}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string };
    if (!res.ok || !j.settings) {
      setError(j.error ?? "Entfernen fehlgeschlagen.");
      return;
    }
    setValues(j.settings);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {saved && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Logo &amp; Hintergrund</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Logo (PNG/JPEG, max. 2 MB)</span>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("logo", f);
              }}
              className="text-sm"
            />
            {values.logoPath && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Aktuell: {values.logoPath.split("/").pop()}</span>
                <button type="button" onClick={() => removeFile("logo")} className="text-rose-600 hover:underline">
                  entfernen
                </button>
              </div>
            )}
            {uploading === "logo" && <span className="text-xs text-slate-400">wird hochgeladen…</span>}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Breite im PDF (mm)</span>
              <input
                type="number"
                value={values.logoWidthMm}
                onChange={(e) => setField("logoWidthMm", Number(e.target.value))}
                className="w-24 rounded border border-slate-300 px-2 py-1"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Hintergrundbild (PNG/JPEG, max. 5 MB)</span>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("background", f);
              }}
              className="text-sm"
            />
            {values.backgroundPath && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Aktuell: {values.backgroundPath.split("/").pop()}</span>
                <button type="button" onClick={() => removeFile("background")} className="text-rose-600 hover:underline">
                  entfernen
                </button>
              </div>
            )}
            {uploading === "background" && <span className="text-xs text-slate-400">wird hochgeladen…</span>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={values.showBackground} onChange={(e) => setField("showBackground", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              <span className="text-slate-700">Hintergrundbild auf Belegen anzeigen</span>
            </label>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Farbe &amp; Schrift</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">Primärfarbe</span>
            <input type="color" value={values.primaryColor} onChange={(e) => setField("primaryColor", e.target.value)} className="h-10 w-20 rounded border border-slate-300" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">Schriftgröße (pt)</span>
            <input type="number" value={values.fontSizePt} onChange={(e) => setField("fontSizePt", Number(e.target.value))} className="w-24 rounded border border-slate-300 px-2 py-1" />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Ränder (mm)</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {(["marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="text-slate-700">{{ marginTopMm: "Oben", marginRightMm: "Rechts", marginBottomMm: "Unten", marginLeftMm: "Links" }[k]}</span>
              <input type="number" value={values[k]} onChange={(e) => setField(k, Number(e.target.value))} className="w-20 rounded border border-slate-300 px-2 py-1" />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Absenderzeile &amp; Fußzeile</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">Absenderzeile</span>
          <input
            value={values.senderLine ?? ""}
            onChange={(e) => setField("senderLine", e.target.value || null)}
            className="rounded border border-slate-300 px-2 py-1"
            placeholder="Firma · Straße · PLZ Ort"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          {(["footerLeft", "footerCenter", "footerRight"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="text-slate-700">{{ footerLeft: "Fußzeile links", footerCenter: "Fußzeile Mitte", footerRight: "Fußzeile rechts" }[k]}</span>
              <textarea value={values[k] ?? ""} onChange={(e) => setField(k, e.target.value || null)} rows={2} className="rounded border border-slate-300 px-2 py-1" />
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? "Speichern…" : "Einstellungen speichern"}
        </button>

        <div className="flex items-center gap-2">
          <select value={previewDocType} onChange={(e) => setPreviewDocType(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
            {PREVIEW_DOC_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <a
            href={`/api/settings/branding/preview?docType=${previewDocType}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF-Vorschau öffnen
          </a>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Die Vorschau nutzt eine feste Musterrechnung mit den echten Absender-Stammdaten und dem zuletzt GESPEICHERTEN Briefpapier — zuerst speichern, dann öffnen.
      </p>
    </div>
  );
}
