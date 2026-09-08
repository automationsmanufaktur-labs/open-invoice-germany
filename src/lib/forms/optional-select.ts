/**
 * Fix-Welle B3: Auflösungs-Hilfsfunktion für ein leeres Auswahlfeld (Ansprechpartner/
 * Rechnungs-/Lieferadresse) im Beleg-Editor. Bei der ANLAGE eines Belegs muss ein leer
 * gelassenes Feld als fehlender Schlüssel (`undefined`) übertragen werden, damit die
 * serverseitige Kundenvorgabe (Default-Adresse/-Ansprechpartner) greift — vorher wurde
 * immer explizit `null` gesendet, wodurch der Default nie zum Zug kam. Beim BEARBEITEN
 * eines bestehenden Belegs bleibt ein geleertes Feld weiterhin explizites `null`
 * (bewusstes Entfernen der Referenz) — sonst würde JSON.stringify das Feld beim PATCH
 * einfach weglassen und die alte Referenz bliebe serverseitig unverändert stehen.
 */
export function optionalSelectValue(value: string, isEdit: boolean): string | null | undefined {
  if (value) return value;
  return isEdit ? null : undefined;
}

/**
 * Beschriftung der leeren Option eines Adress-/Ansprechpartner-Auswahlfelds: nennt die
 * Kundenvorgabe explizit, wenn eine existiert ("— Standard des Kunden —"), sonst neutral
 * ("— keine —") — die bisherige Beschriftung „— Standardadresse —" täuschte einen Default
 * vor, auch wenn der Kunde gar keinen hinterlegt hatte.
 */
export function emptyOptionLabel(hasDefault: boolean): string {
  return hasDefault ? "— Standard des Kunden —" : "— keine —";
}
