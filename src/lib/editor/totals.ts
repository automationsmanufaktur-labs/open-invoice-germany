/**
 * Live-Summen für den Beleg-Editor — reine Funktion (kein `useMemo`, keine
 * React-Abhängigkeit), damit `DocumentEditor` sie ohne doppelte Berechnung als Prop
 * weiterreichen kann. DOCUMENT/DELIVERY_NOTE werden wie REGULAR behandelt (kein
 * Steuerschema-Wechsel für diese Belegarten).
 *
 * Anders als die Formulare heute (die eine ungültige Eingabe stillschweigend als 0
 * behandeln) meldet `computeDraftTotals` eine ungültige Positionsmenge/-preis als
 * `error` statt zu rechnen — beide sind Pflichtfelder, ein nicht parsebarer Wert darf
 * keine (falsche) Summe vortäuschen. Rabatt-/Aufschlag-Prozentsätze und -Beträge
 * (Position und Beleg) werden dagegen wie im Payload-Mapper (draft.ts) über die
 * `…OrZero`-Helfer aus parse.ts geklemmt/defaultet (Fix 1) — sonst würde z. B. "150"
 * bei den Positionsrabatt die Live-Summe in einen Fehler laufen lassen, den das
 * eigentliche Speichern (dort auf 100 % geklemmt) gar nicht widerspiegelt.
 */
import { computeLineNet } from "@/lib/pricing/line";
import { applyDocumentAdjustments, type RateBucket } from "@/lib/pricing/allocate";
import { PricingError } from "@/lib/pricing/errors";
import { computeSubtotals } from "@/domain/document/lines";
import { toCents, toMilli, centsOrZero, permilleOrZero } from "./parse";
import { SCHEME_CATEGORY } from "./constants";
import type { DraftState } from "./draft";

export interface DraftTotals {
  lineNetCents: number;
  allowanceCents: number;
  chargeCents: number;
  netCents: number;
  taxRows: { rate: number; taxCents: number; baseCents: number }[];
  taxCents: number;
  grossCents: number;
  subtotals: number[];
  error: string | null;
}

function zeroTotals(lineCount: number, error: string): DraftTotals {
  return {
    lineNetCents: 0,
    allowanceCents: 0,
    chargeCents: 0,
    netCents: 0,
    taxRows: [],
    taxCents: 0,
    grossCents: 0,
    subtotals: new Array(lineCount).fill(0) as number[],
    error,
  };
}

export function computeDraftTotals(d: DraftState): DraftTotals {
  try {
    const isRegular = d.mode === "INVOICE" ? d.taxScheme === "REGULAR" : true;
    const itemLines = d.lines.filter((l) => l.lineType === "ITEM");

    const lineResults = itemLines.map((l) => {
      const quantityMilli = toMilli(l.quantity);
      const unitNetPriceCents = toCents(l.price);
      if (quantityMilli === null || unitNetPriceCents === null) {
        throw new Error(`Ungültige Eingabe in Position "${l.description || "(ohne Bezeichnung)"}".`);
      }
      // Fix 1: Rabatt-Prozent/-Betrag wie im Payload-Mapper (draft.ts) geklemmt statt
      // strikt geparst — ein Wert außerhalb 0..100 % darf die Live-Summe nicht in einen
      // Fehler laufen lassen, den das eigentliche Speichern (dort ebenfalls geklemmt)
      // gar nicht widerspiegelt.
      const discountPermille = permilleOrZero(l.discountPercent);
      const discountCents = centsOrZero(l.discountAmount);
      return computeLineNet({ quantityMilli, unitNetPriceCents, discountPermille, discountCents });
    });

    const lineNetCents = lineResults.reduce((s, r) => s + r.lineNetCents, 0);

    const byRate = new Map<number, number>();
    itemLines.forEach((l, i) => {
      const rate = isRegular ? l.taxRate : 0;
      byRate.set(rate, (byRate.get(rate) ?? 0) + lineResults[i]!.lineNetCents);
    });
    const category = SCHEME_CATEGORY[d.taxScheme] ?? "S";
    const buckets: RateBucket[] = [...byRate.entries()].map(([taxRate, netCents]) => ({
      key: String(taxRate),
      taxRate,
      taxCategory: category,
      netCents,
    }));

    // Fix 1: wie oben — geklemmt statt strikt, konsistent mit dem Payload-Mapper.
    const documentDiscountPermille = permilleOrZero(d.documentDiscountPercent);
    const documentDiscountCents = centsOrZero(d.documentDiscountAmount);
    const documentChargePermille = permilleOrZero(d.documentChargePercent);
    const documentChargeCents = centsOrZero(d.documentChargeAmount);

    const adjusted = applyDocumentAdjustments(buckets, {
      discountPermille: documentDiscountPermille,
      discountCents: documentDiscountCents,
      chargePermille: documentChargePermille,
      chargeCents: documentChargeCents,
    });

    const taxRows = adjusted.map((b) => ({
      rate: b.taxRate,
      taxCents: Math.round((b.adjustedNetCents * b.taxRate) / 100),
      baseCents: b.adjustedNetCents,
    }));

    const netCents = adjusted.reduce((s, b) => s + b.adjustedNetCents, 0);
    const taxCents = taxRows.reduce((s, r) => s + r.taxCents, 0);
    const allowanceCents = adjusted.reduce((s, b) => s + b.allowanceCents, 0);
    const chargeCents = adjusted.reduce((s, b) => s + b.chargeCents, 0);

    // Subtotal-Zeilen live: Reihenfolge der ITEM-Netto-Ergebnisse deckt sich mit itemLines.
    let itemIdx = 0;
    const subtotalInputs = d.lines.map((l) => {
      if (l.lineType === "ITEM") {
        const r = lineResults[itemIdx++]!;
        return { lineType: l.lineType, lineNetCents: r.lineNetCents };
      }
      return { lineType: l.lineType, lineNetCents: 0 };
    });
    const subtotals = computeSubtotals(subtotalInputs);

    return {
      lineNetCents,
      allowanceCents,
      chargeCents,
      netCents,
      taxRows,
      taxCents,
      grossCents: netCents + taxCents,
      subtotals,
      error: null,
    };
  } catch (e) {
    return zeroTotals(d.lines.length, e instanceof PricingError ? e.message : e instanceof Error ? e.message : "Berechnung fehlgeschlagen.");
  }
}
