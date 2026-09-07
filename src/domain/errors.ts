/**
 * Gemeinsame Domain-Fehlerklasse fuer "nicht gefunden" (mandantengeprueft oder
 * schlicht unbekannte ID). Ersetzt generische `new Error("... nicht gefunden")`-Wuerfe
 * dort, wo Routen sie bisher per Text-Regex auf 404 gemappt haben (Fix-Runde 1, Befund 4)
 * — die Route prueft jetzt `instanceof NotFoundError` statt den Fehlertext zu parsen.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Gemeinsame Domain-Fehlerklasse fuer eine an sich gueltige, aber im aktuellen Zustand
 * des Belegs verbotene Operation (z. B. Duplizieren einer Teil-/Abschlags-/
 * Schlussrechnung) — Routen mappen sie auf 409 Conflict (Fix-Runde 1, Befund 3).
 */
export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}
