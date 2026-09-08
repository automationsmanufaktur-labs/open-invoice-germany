"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BrandingSettingsInput } from "@/schemas";
import { ErrorBanner } from "@/components/forms/fields";
// "@/lib/brand-defaults" hat keine Imports und ist deshalb im Gegensatz zu
// "@/domain/settings/brand" (zieht transitiv den Prisma-Client "@/lib/db" nach sich)
// gefahrlos aus dieser "use client"-Datei importierbar (nur Anzeige-Fallback, keine
// Validierung — die liegt serverseitig in brandingSettingsInputSchema).
import { DEFAULT_APP_NAME as FALLBACK_APP_NAME, DEFAULT_APP_SHORT_NAME as FALLBACK_APP_SHORT_NAME } from "@/lib/brand-defaults";

type UploadKind = "favicon" | "applogo";

/** Welches Feld von `BrandingSettingsInput` ein Upload/Entfernen tatsaechlich aendert —
 *  Fix-Welle 12c (I1): upload()/removeFile() merged frueher die KOMPLETTE Server-Antwort
 *  (`setValues(j.settings)`) in den lokalen Zustand. Die Upload-Route liefert aber den
 *  gespeicherten DB-Stand aller Felder zurueck, nicht nur des hochgeladenen — eine
 *  ungespeicherte Eingabe in Name/Kurzname (oder jedes andere Feld) ging dadurch
 *  kommentarlos verloren, sobald man vor dem Speichern ein Bild hochlud. Jetzt wird nur
 *  das betroffene Pfadfeld gemergt, der Rest des lokalen Zustands bleibt unangetastet. */
const KIND_FIELD: Record<UploadKind, "faviconPath" | "appLogoPath"> = { favicon: "faviconPath", applogo: "appLogoPath" };

/** Rohe Zod-`issues`, wie sie PUT /api/settings/branding bei einem 400 zurueckgibt
 *  (`{ error, issues: e.issues }`) — dieselbe Form wie DocumentEditor.tsx' `flattenIssues`. */
interface SaveErrorIssue {
  path: (string | number)[];
  message: string;
}

function flattenIssues(issues: SaveErrorIssue[] | undefined): string[] {
  if (!issues) return [];
  return issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/** Leerstring ODER reine Leerzeichen -> `null` (Produktvorgabe). Verhindert, dass ein
 *  Nutzer versehentlich " " speichert und serverseitig (brandingSettingsInputSchema:
 *  `.trim().min(1)`) einen Validierungsfehler erhaelt, obwohl das Feld visuell leer wirkt. */
function nameOrNull(raw: string): string | null {
  return raw.trim() === "" ? null : raw;
}

/**
 * Marke-Formular (Phase 12c, Task 4): App-Name/-Kurzname, Favicon-/App-Logo-Upload mit
 * Live-Vorschau der Kopfzeile. Nutzt dieselben zwei Endpunkte wie `BrandingForm`
 * (PUT /api/settings/branding, POST/DELETE /api/settings/branding/upload?kind=…) — keine
 * neue Route. Speichern sendet das VOLLSTAENDIGE BrandingSettingsInput (die Route erwartet
 * das ganze Objekt, kein PATCH).
 */
export function MarkeForm({ initial }: { initial: BrandingSettingsInput }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<UploadKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Cache-Busting fuer die Logo-Vorschau in diesem Formular: die Route liefert ETag +
  // must-revalidate, das reicht dem Browser aber nicht innerhalb derselben Seite, wenn
  // sich nur der Dateiinhalt unter demselben Pfad-Namen aendert.
  const [previewBust, setPreviewBust] = useState(0);

  function setField<K extends keyof BrandingSettingsInput>(key: K, value: BrandingSettingsInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string; issues?: SaveErrorIssue[] };
      if (!res.ok || !j.settings) {
        setError([j.error ?? "Speichern fehlgeschlagen.", ...flattenIssues(j.issues)].join("\n"));
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

  async function upload(kind: UploadKind, file: File) {
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
    setField(KIND_FIELD[kind], j.settings[KIND_FIELD[kind]]);
    setUploading(null);
    setPreviewBust((n) => n + 1);
    router.refresh();
  }

  async function removeFile(kind: UploadKind) {
    setError(null);
    const res = await fetch(`/api/settings/branding/upload?kind=${kind}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string };
    if (!res.ok || !j.settings) {
      setError(j.error ?? "Entfernen fehlgeschlagen.");
      return;
    }
    setField(KIND_FIELD[kind], j.settings[KIND_FIELD[kind]]);
    setPreviewBust((n) => n + 1);
    router.refresh();
  }

  const previewName = values.appName || FALLBACK_APP_NAME;
  const previewShort = values.appShortName || FALLBACK_APP_SHORT_NAME;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error ?? undefined} />
      {saved && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Name</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">Name der Instanz</span>
            <input
              value={values.appName ?? ""}
              onChange={(e) => setField("appName", nameOrNull(e.target.value))}
              maxLength={40}
              placeholder={FALLBACK_APP_NAME}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">Kurzname (Kürzel)</span>
            <input
              value={values.appShortName ?? ""}
              onChange={(e) => setField("appShortName", nameOrNull(e.target.value))}
              maxLength={12}
              placeholder={FALLBACK_APP_SHORT_NAME}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Favicon &amp; App-Logo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="marke-favicon-upload" className="text-sm font-medium text-slate-700">
              Favicon
            </label>
            <input
              id="marke-favicon-upload"
              type="file"
              accept="image/png"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("favicon", f);
              }}
              className="text-sm"
            />
            {values.faviconPath && (
              // M2 (Fix-Welle 12c): der gespeicherte Pfad ist der SHA-256 des Inhalts,
              // kein Dateiname (bewusst — der Originalname wird nicht gespeichert); ihn
              // trotzdem anzuzeigen ueberlief die Spalte. "min-w-0" + "flex-wrap" statt
              // "truncate", damit "entfernen" auf schmalen Spalten in die naechste Zeile
              // faellt, statt vom Text verdraengt zu werden.
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="min-w-0">Favicon hinterlegt</span>
                <button type="button" onClick={() => removeFile("favicon")} className="text-rose-600 hover:underline">
                  entfernen
                </button>
              </div>
            )}
            {uploading === "favicon" && <span className="text-xs text-slate-400">wird hochgeladen…</span>}
            <span className="text-xs text-slate-400">Favicon: quadratisches PNG, 32–512 px, max. 512 KB.</span>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="marke-applogo-upload" className="text-sm font-medium text-slate-700">
              App-Logo
            </label>
            <input
              id="marke-applogo-upload"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload("applogo", f);
              }}
              className="text-sm"
            />
            {values.appLogoPath && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="min-w-0">Logo hinterlegt</span>
                <button type="button" onClick={() => removeFile("applogo")} className="text-rose-600 hover:underline">
                  entfernen
                </button>
              </div>
            )}
            {uploading === "applogo" && <span className="text-xs text-slate-400">wird hochgeladen…</span>}
            <span className="text-xs text-slate-400">Logo: PNG oder JPEG, max. 1 MB, wird auf 28 px Höhe angezeigt.</span>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Vorschau der Kopfzeile</h2>
        <span className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          {values.appLogoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- kein optimierbares statisches Asset (Route liefert dynamisch aus der DB)
            <img src={`/api/branding/appLogo?v=${previewBust}`} alt={previewName} className="h-7 w-auto" />
          ) : (
            <>
              <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">{previewShort}</span>
              {previewName}
            </>
          )}
        </span>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {saving ? "Speichern…" : "Einstellungen speichern"}
      </button>
    </div>
  );
}
