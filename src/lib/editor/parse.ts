/**
 * Reine Parse-/Format-Helfer für Editor-Eingabefelder (Anzeige-String <-> Integer).
 *
 * Anders als `parseEuroToCents`/`parseQuantityToMilli` (`@/lib/money`), die bei
 * ungültiger Eingabe werfen, liefern die `toX`-Funktionen hier `null` — der Editor
 * muss ungültige Zwischenzustände beim Tippen abfangen können, ohne try/catch an
 * jeder Aufrufstelle (siehe `computeDraftTotals`/`validateDraft` in draft.ts/totals.ts).
 */
import { parseEuroToCents, parseQuantityToMilli } from "@/lib/money";

function normalizePercent(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, "");
  if (!cleaned) return null;
  // Wie parseEuroToCents/parseQuantityToMilli: Tausenderpunkte nur entfernen, wenn ein
  // Komma als Dezimaltrenner vorhanden ist.
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Euro-Eingabe ("12,50", "1.234,56", "12.50") -> Cent, oder `null` bei leerer/ungültiger Eingabe. */
export function toCents(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const n = parseEuroToCents(t);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Mengen-Eingabe ("2", "2,5") -> Milliunits, oder `null` bei leerer/ungültiger Eingabe. */
export function toMilli(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const n = parseQuantityToMilli(t);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Prozent-Eingabe ("10", "2,5") -> Promille (0..1000 = 0..100 %), oder `null` bei ungültiger Eingabe. */
export function toPermille(percent: string): number | null {
  const value = normalizePercent(percent);
  return value === null ? null : Math.round(value * 10);
}

/** Cent -> lokalisierter Anzeige-String ohne Währungszeichen, immer 2 Nachkommastellen ("12,50"). */
export function fromCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/** Milliunits -> Anzeige-String mit bis zu 3 Nachkommastellen ohne überflüssige Nullen ("2" oder "2,5"). */
export function fromMilli(milli: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(milli / 1000);
}

/** Promille -> Prozent-Anzeige-String mit bis zu einer Nachkommastelle ("2,5"). */
export function fromPermille(p: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(p / 10);
}

/**
 * "Oder Zero"-Varianten der `toCents`/`toMilli`/`toPermille`-Funktionen oben: ungültige/
 * leere Eingabe -> 0 statt null, `permilleOrZero` zusätzlich auf 0..1000 geklemmt.
 * Payload-Mapper (draft.ts) UND
 * Live-Summen (totals.ts) verwenden dieselben Funktionen, damit ein außerhalb des
 * gültigen Bereichs liegender Prozentwert (z. B. "150" %) in beiden konsistent auf
 * 100 % geklemmt wird statt in den Summen einen Fehler zu erzeugen, den das
 * eigentliche Speichern gar nicht widerspiegelt.
 */
export function centsOrZero(s: string): number {
  return toCents(s) ?? 0;
}
export function milliOrZero(s: string): number {
  return toMilli(s) ?? 0;
}
export function permilleOrZero(s: string): number {
  const p = toPermille(s);
  if (p === null) return 0;
  return Math.max(0, Math.min(1000, p));
}
