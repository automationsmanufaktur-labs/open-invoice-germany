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

/**
 * Fix-Runde 1 (Koordinator-Ruling c, Task 3, Phase 10): EN-16931-Kernvalidierung einer
 * XRechnung/eines ZUGFeRD-Exports ist fehlgeschlagen (§52 — keine nur optisch korrekte
 * E-Rechnung). `issues` traegt die einzelnen Regelverletzungen (validateXRechnung()).
 * Wird von src/api/files.ts#getDocumentFile geworfen (v1-Dateirouten UND MCP-Tool
 * get_document_file, Paritaet — kein optionaler "validate"-Schalter) auf 409 gemappt
 * (Code EINVOICE_INVALID, src/api/errors.ts).
 */
export class EInvoiceInvalidError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`EN-16931-Kernvalidierung fehlgeschlagen: ${issues.join("; ")}`);
    this.name = "EInvoiceInvalidError";
    this.issues = issues;
  }
}
