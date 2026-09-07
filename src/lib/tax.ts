/**
 * Umsatzsteuer-Berechnung nach EN 16931 / § 14 UStG.
 *
 * Die Steuer wird **pro Steuersatz-/Kategorie-Gruppe** berechnet (nicht je
 * Position) — so verlangt es EN 16931 (BG-23 VAT BREAKDOWN) und es vermeidet
 * Rundungsdifferenzen zwischen Summe-der-Positionen und Gesamtsteuer.
 */
import { roundHalfUp } from "./money";
import { applyDocumentAdjustments, type DocumentAdjustments, type RateBucket } from "./pricing/allocate";

/** UNTDID-5305 Steuerkategorie-Codes (Teilmenge). */
export type TaxCategory =
  | "S" // Standard rate
  | "AE" // Reverse charge (§ 13b)
  | "K" // Innergemeinschaftliche Lieferung (§ 6a)
  | "G" // Export außerhalb EU
  | "E" // Steuerbefreit (z.B. Kleinunternehmer § 19)
  | "Z" // Nullsatz
  | "O"; // Out of scope (nicht im Inland steuerbar, § 3a Abs. 2 UStG)

export interface TaxLineInput {
  lineNetCents: number;
  taxRate: number; // Prozent: 19 | 7 | 0
  taxCategory: TaxCategory | string;
}

export interface TaxBreakdownEntry {
  taxCategory: string;
  taxRate: number;
  /** Netto NACH Belegrabatt/-aufschlag — Bemessungsgrundlage der Steuer. */
  netCents: number;
  taxCents: number;
  /** Netto VOR Belegrabatt/-aufschlag (Summe der Positionsnetti dieser Gruppe). */
  baseNetCents: number;
  /** Anteiliger Belegrabatt dieser Gruppe (Largest-Remainder-Aufteilung). */
  allowanceCents: number;
  /** Anteiliger Belegaufschlag dieser Gruppe (Largest-Remainder-Aufteilung). */
  chargeCents: number;
}

export interface TaxTotals {
  netTotalCents: number;
  taxTotalCents: number;
  grossTotalCents: number;
  breakdown: TaxBreakdownEntry[];
  /** Σ Positionsnetti vor jeder Beleganpassung. */
  lineTotalCents: number;
  /** Σ Belegrabatt über alle Gruppen. */
  allowanceTotalCents: number;
  /** Σ Belegaufschlag über alle Gruppen. */
  chargeTotalCents: number;
}

/**
 * Gruppiert Positionen nach (Steuersatz, -kategorie), wendet optional einen
 * Belegrabatt/-aufschlag proportional je Gruppe an (`applyDocumentAdjustments`)
 * und berechnet die Steuer je Gruppe = round(adjustedNet * taxRate / 100).
 * Ohne `adjustments` ist das Ergebnis byte-gleich zum bisherigen Verhalten,
 * da ein leeres `DocumentAdjustments` zu Allowance/Charge = 0 führt.
 */
export function computeTaxBreakdown(
  lines: readonly TaxLineInput[],
  adjustments?: DocumentAdjustments,
): TaxTotals {
  const groups = new Map<string, RateBucket>();

  for (const line of lines) {
    const key = `${line.taxCategory}:${line.taxRate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.netCents += line.lineNetCents;
    } else {
      groups.set(key, {
        key,
        taxCategory: String(line.taxCategory),
        taxRate: line.taxRate,
        netCents: line.lineNetCents,
      });
    }
  }

  const buckets = [...groups.values()];
  const lineTotalCents = buckets.reduce((s, b) => s + b.netCents, 0);
  const adjusted = applyDocumentAdjustments(buckets, adjustments ?? {});

  let netTotalCents = 0;
  let taxTotalCents = 0;
  let allowanceTotalCents = 0;
  let chargeTotalCents = 0;
  const breakdown: TaxBreakdownEntry[] = [];

  for (const b of adjusted) {
    const taxCents = roundHalfUp((b.adjustedNetCents * b.taxRate) / 100);
    netTotalCents += b.adjustedNetCents;
    taxTotalCents += taxCents;
    allowanceTotalCents += b.allowanceCents;
    chargeTotalCents += b.chargeCents;
    breakdown.push({
      taxCategory: b.taxCategory,
      taxRate: b.taxRate,
      netCents: b.adjustedNetCents,
      taxCents,
      baseNetCents: b.netCents,
      allowanceCents: b.allowanceCents,
      chargeCents: b.chargeCents,
    });
  }

  breakdown.sort(
    (a, b) => a.taxCategory.localeCompare(b.taxCategory) || a.taxRate - b.taxRate,
  );

  return {
    netTotalCents,
    taxTotalCents,
    grossTotalCents: netTotalCents + taxTotalCents,
    breakdown,
    lineTotalCents,
    allowanceTotalCents,
    chargeTotalCents,
  };
}

/** Steuerschemata, die eine 0-%-/befreite Behandlung erzwingen. */
export const ZERO_TAX_SCHEMES = new Set([
  "KLEINUNTERNEHMER",
  "REVERSE_CHARGE",
  "IG_LIEFERUNG",
  "IG_LEISTUNG",
  "DRITTLAND_LEISTUNG",
]);

/** Default-Steuerkategorie je Schema (für neue Positionen/Hinweise). */
export function defaultCategoryForScheme(scheme: string): TaxCategory {
  switch (scheme) {
    case "KLEINUNTERNEHMER":
      return "E";
    case "REVERSE_CHARGE":
      return "AE";
    case "IG_LIEFERUNG":
      return "K";
    case "IG_LEISTUNG":
      return "AE";
    case "DRITTLAND_LEISTUNG":
      return "O";
    default:
      return "S";
  }
}
