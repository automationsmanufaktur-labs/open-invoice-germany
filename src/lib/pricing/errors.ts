/**
 * Fehlerklasse für das Rechenmodul `src/lib/pricing/`.
 *
 * Wird geworfen, wenn eine Berechnung gegen eine harte Invariante verstößt
 * (z. B. ein Rabatt übersteigt die Nettosumme, oder eine Aufteilung würde
 * negative Beträge erzeugen). Nie DB- oder Request-spezifisch — das Modul
 * bleibt frei von Prisma/Next-Importen.
 */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}
