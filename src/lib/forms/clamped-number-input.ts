/**
 * Fix-Welle 12a (M6, Fix 2): reine Hilfsfunktion zum Parsen/Klemmen eines
 * `<input type="number">`-Werts BEIM VERLASSEN DES FELDES (`onBlur`) bzw. unmittelbar
 * vor dem Absenden des Formulars — NICHT bei jedem Tastendruck.
 *
 * Fix 1 rief diese Funktion noch in `onChange` auf: ein zweistelliger Zielwert wie
 * "18" (Spanne 15-40) war damit gar nicht eintippbar, weil bereits die erste Ziffer
 * ("1") auf `min` geklemmt wurde ("15") und die zweite Ziffer sich an das schon
 * geklemmte Ergebnis anhaengte ("158" -> `max` = "40") statt an die Roheingabe. Die
 * drei Formulare (PrintSettingsForm, PrintOptionsPanel, BrandingForm) halten den
 * Rohtext waehrend des Tippens jetzt in einem eigenen Draft-State (leer/unvollstaendig
 * erlaubt, kein Klemmen) und rufen diese Funktion erst in `onBlur` bzw. vor dem
 * Speichern auf.
 *
 * Ein leeres oder nicht-numerisches Feld faellt auf `previousValue` zurueck (den
 * zuletzt gueltigen committeten Wert) statt auf `min` — das verhindert, dass ein
 * versehentlich geleertes Feld beim Verlassen stillschweigend auf die Untergrenze
 * springt.
 */
export function parseClampedNumberInput(raw: string, min: number, max: number, previousValue: number): number {
  const trimmed = raw.trim();
  if (trimmed === "") return previousValue;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return previousValue;
  return Math.min(max, Math.max(min, n));
}
