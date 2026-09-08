/**
 * Geld- und Mengen-Arithmetik in Ganzzahlen.
 *
 * Geldbeträge werden durchgängig in **Cent** (Integer) gehalten, Mengen in
 * **Milliunits** (1/1000, Integer). Damit gibt es keine Float-Rundungsfehler
 * und das Modell ist zwischen SQLite und PostgreSQL portabel.
 */

export const CENTS_PER_EURO = 100;
export const MILLI = 1000;

/** Kaufmännische Rundung (half-up, symmetrisch um 0). */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Formatiert Cent als lokalisierten Währungs-String (Default de-DE/EUR). */
export function formatCents(cents: number, currency = "EUR", locale = "de-DE"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / CENTS_PER_EURO);
}

/**
 * Kompakte Kurzform fuer schmale Achsenbeschriftungen (Fix I5, Abschluss-Review, BarChart-
 * y-Achse): ab 1.000 € "x,y k€" (eine Nachkommastelle), darunter der volle `formatCents`-
 * String — eine vierstellige Beschriftung ("1.234,56 €") sprengt sonst die schmale y-Achse.
 * Vorzeichen bleibt erhalten ("-1,2 k€").
 */
export function formatCentsShort(cents: number, locale = "de-DE"): string {
  if (Math.abs(cents) < CENTS_PER_EURO * 1000) return formatCents(cents);
  const thousandEuros = cents / (CENTS_PER_EURO * 1000);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(thousandEuros)} k€`;
}

/** Parst eine deutsche/englische Geldeingabe ("1.234,56" oder "1234.56") nach Cent. */
export function parseEuroToCents(input: string): number {
  const cleaned = input.trim().replace(/\s|€/g, "");
  // Deutsches Format mit Komma als Dezimaltrenner
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Ungültiger Geldbetrag: ${input}`);
  return roundHalfUp(value * CENTS_PER_EURO);
}

/** Menge (Milliunits) als String mit bis zu 3 Nachkommastellen. */
export function formatQuantity(quantityMilli: number, locale = "de-DE"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(quantityMilli / MILLI);
}

/** Parst eine Mengeneingabe ("2,5" oder "2.5") nach Milliunits. */
export function parseQuantityToMilli(input: string): number {
  const cleaned = input.trim().replace(/\s/g, "");
  // Tausenderpunkte nur entfernen, wenn ein Komma als Dezimaltrenner vorhanden ist.
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Ungültige Menge: ${input}`);
  return roundHalfUp(value * MILLI);
}
