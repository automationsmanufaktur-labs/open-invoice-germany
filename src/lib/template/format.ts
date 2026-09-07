/** Deutsche Formatierung fuer Platzhalter (Datum dd.MM.yyyy, Geld 1.234,56 €). */
export function formatDateDe(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(d);
}

/** Tausendertrennung nach de-DE (Punkt); Fallback, falls Intl nur small-icu hat. */
function thousandsDe(n: number): string {
  const formatted = n.toLocaleString("de-DE");
  // small-icu liefert unter Umstaenden keine Gruppierung -> manueller Fallback.
  if (n >= 1000 && !formatted.includes(".")) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  return formatted;
}

export function formatMoneyDe(cents: number | null | undefined, currency = "EUR"): string {
  if (cents === null || cents === undefined) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = thousandsDe(Math.floor(abs / 100));
  const rest = String(abs % 100).padStart(2, "0");
  const symbol = currency === "EUR" ? "€" : currency;
  return `${sign}${euros},${rest} ${symbol}`;
}
