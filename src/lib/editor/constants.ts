/**
 * Statische Konstanten für den gemeinsamen Beleg-Editor (Phase 11c). Steuerkategorie
 * und Pflichthinweistexte werden bewusst NICHT hier neu definiert, sondern von der
 * bestehenden, massgeblichen Quelle übernommen (Lastenheft 1.4/61.5 — nichts doppelt
 * bauen): `defaultCategoryForScheme` (`@/lib/tax`) bzw. `SCHEME_NOTICE`
 * (`@/domain/invoice/mandatory`, dort bereits von `validateMandatoryFields` geprüft).
 */
import { TaxScheme as TaxSchemeSchema, type TaxScheme, type TaxCategory } from "@/schemas";
import { defaultCategoryForScheme } from "@/lib/tax";
import { SCHEME_NOTICE as MANDATORY_SCHEME_NOTICE } from "@/domain/invoice/mandatory";

export type EditorMode = "INVOICE" | "DOCUMENT" | "DELIVERY_NOTE";

export const LINE_TYPE_LABEL: Record<"ITEM" | "HEADING" | "TEXT" | "SUBTOTAL", string> = {
  ITEM: "Position",
  HEADING: "Überschrift",
  TEXT: "Textblock",
  SUBTOTAL: "Zwischensumme",
};

/** Phase 12c — die Auswahl kommt aus DocumentSettings.taxRates (Server-Prop bis in die
 *  Zeile), nicht mehr aus einer festen Union. `FALLBACK_TAX_RATES` deckt nur den Fall ab,
 *  dass eine Seite die Liste (noch) nicht durchreicht. */
export const FALLBACK_TAX_RATES: readonly number[] = [19, 7, 0];

export function taxRateOptions(rates: readonly number[]): { value: number; label: string }[] {
  const source = rates.length > 0 ? rates : FALLBACK_TAX_RATES;
  // M4 (Fix-Welle 12c): `assertAllowedTaxRates` laesst 0 % IMMER zu (Gliederungszeilen,
  // Nullsatz-Schemata — tax-rates.ts:41) und `LineRow` setzt bei `taxDisabled` den Wert
  // hart auf 0. Nimmt eine Organisation 0 aus ihrer eigenen Liste heraus, fehlte bislang
  // die passende <option>, der Browser zeigte dann die erste Option statt 0 an.
  return [...new Set([...source, 0])].sort((a, b) => b - a).map((value) => ({ value, label: `${value}%` }));
}

// UN/ECE Rec 20 Einheiten-Codes (Teilmenge, siehe Hinweistext in
// src/components/forms/ProductForm.tsx) — C62 (Stück) zuerst als Standardwert.
// M7 (Abschluss-Review): um LTR/MTK/H87 auf die im Plan (docs/superpowers/plans/
// 2026-09-07-phase-11c-editor.md) vorgesehene Liste erweitert — vorher fehlten drei
// gaengige Einheiten, die nur ueber "andere…" (Freitext) erreichbar waren.
export const UNIT_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "C62", label: "Stk" },
  { code: "HUR", label: "Stunde" },
  { code: "DAY", label: "Tag" },
  { code: "KGM", label: "kg" },
  { code: "MTR", label: "m" },
  { code: "LTR", label: "l" },
  { code: "MTK", label: "m²" },
  { code: "H87", label: "Stück-Pauschale" },
];

// Vollständiges Record (alle TaxScheme-Werte) für synchrone Lookups je Zeile/Beleg,
// ohne Funktionsaufruf in Schleifen — Werte identisch mit defaultCategoryForScheme.
export const SCHEME_CATEGORY: Record<TaxScheme, TaxCategory> = Object.fromEntries(
  TaxSchemeSchema.options.map((scheme) => [scheme, defaultCategoryForScheme(scheme)]),
) as Record<TaxScheme, TaxCategory>;

// Pflichthinweistexte (§ 14a UStG) — identisch mit src/domain/invoice/mandatory.ts
// (dort die massgebliche Quelle, siehe validateMandatoryFields).
export const SCHEME_NOTICE: Partial<Record<TaxScheme, string>> = MANDATORY_SCHEME_NOTICE as Partial<Record<TaxScheme, string>>;

/** Phase 12a — Grenze fuer Kopf-/Fusstext. Keine eigene Regel, sondern Spiegel von
 *  `z.string().max(5000)` in `invoiceHeaderFields` (headerText/footerText,
 *  src/schemas/index.ts:352/353); dieselbe Zahl gilt fuer Quote und DeliveryNote. */
export const LONG_TEXT_MAX = 5000;

export function charCountLabel(value: string, max: number = LONG_TEXT_MAX): string {
  return `${value.length} / ${max}`;
}

export function charCountTone(value: string, max: number = LONG_TEXT_MAX): "ok" | "warn" | "over" {
  if (value.length > max) return "over";
  if (value.length >= max * 0.9) return "warn";
  return "ok";
}

/** Panelbreite des Vorschau-Overlays: schmal = eine A4-Seite bei 96 dpi (794 px) mit Rand,
 *  breit = volle Overlay-Breite. `w-full` in beiden Faellen, sonst faellt das Panel auf
 *  schmalen Fenstern auf fit-content zusammen. */
export function previewPanelClass(wide: boolean): string {
  return wide ? "w-full max-w-none" : "w-full max-w-[1100px]";
}

export const PREVIEW_WIDE_KEY = "oig.preview.wide";
