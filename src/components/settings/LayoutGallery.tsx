"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BrandingSettingsInput } from "@/schemas";
import { LAYOUT_DOC_TYPES, LAYOUT_DOC_TYPE_LABEL, type LayoutDocType, type LayoutId } from "@/lib/pdf/layouts/ids";

interface LayoutInfo {
  id: LayoutId;
  name: string;
  description: string;
}

/** Belegtyp der Galerie -> Belegtyp der Vorschau-Route (`/api/settings/branding/preview`),
 *  die nur fuenf Typen kennt: Angebot, Auftragsbestaetigung und Proforma teilen sich
 *  denselben Muster-Renderer (ANGEBOT). */
type PreviewDocType = "INVOICE" | "CREDIT_NOTE" | "ANGEBOT" | "DELIVERY_NOTE" | "DUNNING";
const PREVIEW_DOC_TYPE_MAP: Record<LayoutDocType, PreviewDocType> = {
  INVOICE: "INVOICE",
  CREDIT_NOTE: "CREDIT_NOTE",
  QUOTE: "ANGEBOT",
  ORDER_CONFIRMATION: "ANGEBOT",
  PROFORMA: "ANGEBOT",
  DELIVERY_NOTE: "DELIVERY_NOTE",
  DUNNING: "DUNNING",
};

/**
 * Layout-Galerie (Phase 11b, Task 7, §"Layout-Auswahl"): Kacheln mit SVG-Thumbnail je
 * Layout, Live-Vorschau als PDF-iframe, Auswahl je Belegtyp oder als Organisationsstandard.
 * Ein Kachel-Klick aendert nur den lokalen Entwurf (`values`) — anders als bei manchen Rechnungsdiensten gibt
 * es KEIN sofortiges Speichern beim Klicken (Ruling der Spec); erst „Speichern“ sendet das
 * vollstaendige Branding-Objekt an `PUT /api/settings/branding` (bestehender Vertrag, wie
 * `BrandingForm.save()`).
 *
 * Fix-Welle (Abschluss-Review, Block 4 "Important"): ein Kachel-Klick schrieb bisher SOFORT
 * in `values.layoutByType[docType]` — "Als Standard für alle" setzte danach `layoutByType`
 * komplett zurueck (`{}`) und loeschte damit STILLSCHWEIGEND jede zuvor gesetzte Typ-
 * Zuordnung, auch fuer andere Belegtypen als den gerade angezeigten. Ein Kachel-Klick
 * aendert jetzt nur noch den lokalen `selection`-Entwurf (Vorschau-Ring); erst „Für <Typ>
 * übernehmen“ schreibt ihn in `layoutByType`. „Als Standard für alle“ setzt NUR `layoutId`
 * und laesst `layoutByType` unangetastet. Ein neuer Link „Organisationsstandard verwenden“
 * entfernt die Zuordnung fuer den aktuell gewaehlten Belegtyp gezielt (vorher gab es dafuer
 * keinen Weg — `applyForType()` war ein reiner No-op, weil der Kachel-Klick den Wert schon
 * geschrieben hatte).
 */
export function LayoutGallery({ initial, layouts }: { initial: BrandingSettingsInput; layouts: LayoutInfo[] }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  // Referenz fuer "ungespeichert": nach dem Speichern auf den Server-Stand gesetzt.
  const [baseline, setBaseline] = useState(initial);
  const [docType, setDocType] = useState<LayoutDocType>("INVOICE");
  // `selection` ist der lokale Entwurf (welche Kachel gerade als Vorschau angezeigt wird) —
  // getrennt vom tatsaechlich WIRKSAMEN Layout (`effective` unten), das erst durch „Für
  // <Typ> übernehmen“/„Als Standard für alle“ + „Speichern“ uebernommen wird.
  const [selection, setSelection] = useState<LayoutId>(initial.layoutByType[docType] ?? initial.layoutId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const docLabel = LAYOUT_DOC_TYPE_LABEL[docType];
  const typeOverride = values.layoutByType[docType];
  const effective: LayoutId = typeOverride ?? values.layoutId;

  function changeDocType(next: LayoutDocType) {
    setDocType(next);
    setSelection(values.layoutByType[next] ?? values.layoutId);
    setError(null);
    setSaved(false);
  }

  // Betreiber-Befund (2026-09-07): Kachel-Klick UEBERNIMMT das Layout fuer den gewaehlten
  // Belegtyp direkt (wie bei gaengigen Rechnungsdiensten) — die Zwischenstufe "Fuer <Typ> uebernehmen" wurde als
  // reine Auswahl missverstanden, der Speicher-Aufruf blieb aus. Persistiert wird weiterhin
  // erst mit "Einstellungen speichern" (Hinweis auf ungespeicherte Aenderungen unten).
  function selectTile(layoutId: LayoutId) {
    setSelection(layoutId);
    setError(null);
    setSaved(false);
    setValues((v) => ({ ...v, layoutByType: { ...v.layoutByType, [docType]: layoutId } }));
  }

  /** Entfernt die Typ-Zuordnung fuer den aktuell gewaehlten Belegtyp — der Beleg faellt
   *  danach auf den Organisationsstandard (`layoutId`) zurueck. */
  function useOrgDefaultForType() {
    setSaved(false);
    setValues((v) => {
      if (!(docType in v.layoutByType)) return v;
      const rest = { ...v.layoutByType };
      delete rest[docType];
      return { ...v, layoutByType: rest };
    });
    setSelection(values.layoutId);
  }

  function applyAsDefault() {
    setSaved(false);
    // Fix-Welle: NUR `layoutId` — `layoutByType` bleibt unangetastet (siehe Kommentar oben).
    setValues((v) => ({ ...v, layoutId: selection }));
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
      const j = (await res.json().catch(() => ({}))) as { settings?: BrandingSettingsInput; error?: string };
      if (!res.ok || !j.settings) {
        setError(j.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setValues(j.settings);
      setBaseline(j.settings);
      setSaved(true);
      router.refresh();
    } catch {
      // Fix-Welle (Abschluss-Review, Block 4 "Minor"): `fetch` kann bei einem Netzwerkfehler
      // werfen (nicht nur ein Nicht-200-Status) — ohne try/catch blieb der Button dann bis
      // zum Neuladen auf "Speichern…" haengen, weil `setSaving(false)` nie erreicht wurde.
      setError("Netzwerkfehler beim Speichern. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
  }

  const previewDocType = PREVIEW_DOC_TYPE_MAP[docType];
  const dirty = JSON.stringify({ l: values.layoutId, t: values.layoutByType }) !== JSON.stringify({ l: baseline.layoutId, t: baseline.layoutByType });

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {saved && <p className="text-sm text-emerald-700">Einstellungen gespeichert.</p>}

      <label className="flex max-w-xs flex-col gap-1 text-sm">
        <span className="text-slate-700">Belegtyp</span>
        <select
          value={docType}
          onChange={(e) => changeDocType(e.target.value as LayoutDocType)}
          className="rounded-md border border-slate-300 px-2 py-2"
        >
          {LAYOUT_DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {LAYOUT_DOC_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {layouts.map((l) => {
            // Ring/Rahmen: welche Kachel gerade als Vorschau ausgewaehlt ist (`selection`).
            const isSelected = l.id === selection;
            // Badge: welche Kachel TATSAECHLICH wirksam ist (`effective`) — kann von
            // `selection` abweichen, solange die Auswahl noch nicht uebernommen wurde.
            const isEffective = l.id === effective;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => selectTile(l.id)}
                aria-pressed={isSelected}
                className={`relative flex flex-col gap-2 rounded-lg border p-3 text-left transition ${
                  isSelected ? "border-indigo-600 ring-2 ring-indigo-600" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                {isEffective && (
                  <span className="absolute right-2 top-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-white">
                    {typeOverride ? `Für ${docLabel}` : "Standard"}
                  </span>
                )}
                <img src={`/layouts/${l.id}.svg`} alt="" className="w-full rounded border border-slate-100" />
                <div>
                  <div className="text-sm font-bold text-slate-900">{l.name}</div>
                  <p className="text-xs text-slate-500">{l.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          <iframe
            key={`${docType}-${selection}`}
            src={`/api/settings/branding/preview?docType=${previewDocType}&layoutId=${selection}`}
            title="Layout-Vorschau"
            className="aspect-[1/1.414] w-full rounded border border-slate-200 bg-white"
          />
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-600">
              Kachel anklicken = Layout für <span className="font-medium">{docLabel}</span> übernehmen.
            </p>
            {typeOverride && (
              <button
                type="button"
                onClick={useOrgDefaultForType}
                className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
              >
                Organisationsstandard verwenden
              </button>
            )}
            <button
              type="button"
              onClick={applyAsDefault}
              className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Als Standard für alle
            </button>
            <p className="text-[11px] text-slate-500">Typ-Zuordnungen bleiben erhalten.</p>
          </div>
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${dirty ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? "Speichern…" : "Einstellungen speichern"}
        </button>
        {dirty && <span className="text-sm text-amber-800">Ungespeicherte Änderungen — erst nach dem Speichern wirken sie auf neue PDFs.</span>}
        {!dirty && saved && <span className="text-sm text-emerald-700">Gespeichert.</span>}
      </div>
    </div>
  );
}
