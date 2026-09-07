/**
 * Fix-Welle B6: Rabattfeld-Vorbelegung beim Kundenwechsel im Beleg-Editor
 * (NewInvoiceForm/NewDocumentForm). Vorher wurde das Feld nur beim ERSTEN Kundenwechsel
 * aus der Kundenvorgabe befuellt (Init aus customers[0], danach Overwrite nur wenn das
 * Feld komplett leer war) — wechselte man ein zweites Mal den Kunden, blieb der Rabatt
 * des vorigen Kunden stehen, obwohl der Nutzer ihn nie selbst editiert hatte (Geldfehler).
 *
 * Diese reine Funktion entscheidet, ob das Rabattfeld beim Kundenwechsel ueberschrieben
 * werden darf: nur wenn es LEER ist ODER noch exakt dem zuletzt automatisch angewendeten
 * Default entspricht (der Nutzer hat es also seit der letzten Automatik nicht selbst
 * geaendert) — eine eigene Eingabe wird nie stillschweigend ueberschrieben.
 */
export function nextDiscountOnCustomerChange(
  currentValue: string,
  lastAppliedDefault: string,
  newDefault: string,
): { apply: true; value: string } | { apply: false } {
  const trimmed = currentValue.trim();
  if (trimmed === "" || trimmed === lastAppliedDefault.trim()) {
    return { apply: true, value: newDefault };
  }
  return { apply: false };
}
