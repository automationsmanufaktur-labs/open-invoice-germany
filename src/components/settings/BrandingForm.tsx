"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BrandingSettingsInput } from "@/schemas";
import { parseClampedNumberInput } from "@/lib/forms/clamped-number-input";

/** Briefpapier-Einstellungen (§35): Logo-/Hintergrund-Upload, Farbe, Ränder, Fußzeilen.
 *  Die Live-Vorschau (vormals eine feste PDF-Vorschau hier im Formular) lebt seit Phase 11b,
 *  Task 7 im Reiter "Layouts" (Galerie mit iframe-Vorschau je Belegtyp) — kein doppelter
 *  Vorschau-Mechanismus mehr. */
export function BrandingForm({ initial }: { initial: BrandingSettingsInput }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "background" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  // Fix-Welle 12a, Fix 2: Rohtext waehrend des Tippens, getrennt von `values.logoWidthMm`
  // (siehe clamped-number-input.ts). `null` = kein aktiver Draft, Feld + Regler zeigen
  // den committeten Wert.
  const [logoWidthDraft, setLogoWidthDraft] = useState<string | null>(null);

  function setField<K extends keyof BrandingSettingsInput>(key: K, value: BrandingSettingsInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    // Fix-Welle 12a, Fix 2: vor dem Speichern einen noch nicht per onBlur committeten
    // Draft nachziehen (z. B. wenn der Button ohne vorherigen Fokuswechsel ausgeloest wird).
    const payload: BrandingSettingsInput =
      logoWidthDraft !== null ? { ...values, logoWidthMm: parseClampedNumberInput(logoWidthDraft, 10, 140, values.logoWidthMm) } : values;
    if (logoWidthDraft !== null) {
      setValues(payload);
      setLogoWidthDraft(null);
    }
    // Fix-Welle (Abschluss-Review, Block 4 "Minor"): try/catch + `finally` — ein
    // Netzwerkfehler (nicht nur ein Nicht-200-Status) liess den Button vorher bis zum
    // Neuladen auf "Speichern…" haengen, weil `setSaving(false)` nie erreicht wurde
    // (siehe dasselbe Muster in LayoutGallery.tsx#save).
    try {
      const res = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string };
      if (!res.ok || !j.settings) {
        setError(j.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setValues(j.settings);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Netzwerkfehler beim Speichern. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
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
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={140}
                  step={1}
                  value={values.logoWidthMm}
                  onChange={(e) => {
                    // Regler liefert immer einen gueltigen Wert (kein Draft noetig) —
                    // ein evtl. noch offener Draft im Zahlenfeld wird verworfen, damit
                    // beide Steuerelemente synchron bleiben.
                    setField("logoWidthMm", Number(e.target.value));
                    setLogoWidthDraft(null);
                  }}
                  className="w-56"
                  aria-label="Logobreite in Millimeter"
                />
                <input
                  type="number"
                  min={10}
                  max={140}
                  value={logoWidthDraft ?? String(values.logoWidthMm)}
                  onChange={(e) => setLogoWidthDraft(e.target.value)}
                  onBlur={() => {
                    setValues((v) => ({ ...v, logoWidthMm: parseClampedNumberInput(logoWidthDraft ?? String(v.logoWidthMm), 10, 140, v.logoWidthMm) }));
                    setLogoWidthDraft(null);
                  }}
                  className="w-24 rounded border border-slate-300 px-2 py-1"
                />
              </div>
              <span className="text-xs text-slate-400">10–140 mm; die Höhe wird auf 35 mm begrenzt, damit hohe Logos nicht in den Adressblock laufen.</span>
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
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium text-slate-700">Fußzeile</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="footerMode"
              checked={values.footerMode === "AUTO"}
              onChange={() => setField("footerMode", "AUTO")}
              className="h-4 w-4 border-slate-300"
            />
            <span className="text-slate-700">automatisch aus den Stammdaten (vierspaltig)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="footerMode"
              checked={values.footerMode === "CUSTOM"}
              onChange={() => setField("footerMode", "CUSTOM")}
              className="h-4 w-4 border-slate-300"
            />
            <span className="text-slate-700">eigene Texte (drei Spalten)</span>
          </label>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          {(["footerLeft", "footerCenter", "footerRight"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="text-slate-700">{{ footerLeft: "Fußzeile links", footerCenter: "Fußzeile Mitte", footerRight: "Fußzeile rechts" }[k]}</span>
              <textarea
                value={values[k] ?? ""}
                onChange={(e) => setField(k, e.target.value || null)}
                rows={2}
                disabled={values.footerMode !== "CUSTOM"}
                className="rounded border border-slate-300 px-2 py-1 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? "Speichern…" : "Einstellungen speichern"}
        </button>

        <Link
          href="/einstellungen/briefpapier?tab=layouts"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Layout &amp; Live-Vorschau →
        </Link>
      </div>
      <p className="text-xs text-slate-400">
        Layout-Auswahl je Belegtyp und eine Live-Vorschau finden Sie im Reiter „Layouts“.
      </p>
    </div>
  );
}
