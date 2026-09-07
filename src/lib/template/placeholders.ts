/** Statische Platzhalter-Referenz fuer den Vorlagen-Editor (Lastenheft 19, Abschnitt 5). */
export const TEMPLATE_PLACEHOLDERS: { path: string; label: string }[] = [
  { path: "company.name", label: "Firmenname" },
  { path: "company.email", label: "Firmen-E-Mail" },
  { path: "company.phone", label: "Firmentelefon" },
  { path: "customer.name", label: "Kundenname" },
  { path: "customer.firstName", label: "Ansprechpartner Vorname" },
  { path: "customer.lastName", label: "Ansprechpartner Nachname" },
  { path: "customer.email", label: "Kunden-E-Mail" },
  { path: "contact.name", label: "Ansprechpartner (voller Name)" },
  // Phase 8a (§30): Einzelfelder des am Beleg gewaehlten Ansprechpartners (Snapshot,
  // contactSnapshotJson) — Ergaenzung zu `contact.name` (Legacy, aus Customer.contactName).
  { path: "contact.firstName", label: "Ansprechpartner Vorname (Kontakt)" },
  { path: "contact.lastName", label: "Ansprechpartner Nachname (Kontakt)" },
  { path: "contact.email", label: "Ansprechpartner E-Mail (Kontakt)" },
  { path: "contact.role", label: "Ansprechpartner Funktion" },
  { path: "contact.phone", label: "Ansprechpartner Telefon" },
  { path: "payment.iban", label: "IBAN" },
  { path: "payment.bic", label: "BIC" },
  { path: "document.type", label: "Belegart" },
  { path: "document.number", label: "Belegnummer" },
  { path: "document.date", label: "Belegdatum" },
  { path: "document.dueDate", label: "Fälligkeitsdatum" },
  { path: "document.total", label: "Bruttobetrag" },
  { path: "document.netTotal", label: "Nettobetrag" },
  { path: "document.taxTotal", label: "Steuerbetrag" },
  { path: "invoice.number", label: "Rechnungsnummer" },
  { path: "invoice.date", label: "Rechnungsdatum" },
  { path: "invoice.total", label: "Rechnungsbetrag" },
  { path: "invoice.dueDate", label: "Fälligkeitsdatum (Rechnung)" },
  { path: "invoice.openAmount", label: "Offener Betrag" },
  { path: "offer.number", label: "Angebotsnummer" },
  { path: "offer.validUntil", label: "Angebot gültig bis" },
  { path: "dunning.level", label: "Mahnstufe" },
  { path: "dunning.stageName", label: "Name der Mahnstufe" },
  { path: "dunning.number", label: "Mahnungsnummer" },
  { path: "dunning.newDueDate", label: "Neue Fälligkeit" },
  { path: "dunning.fee", label: "Mahngebühr" },
  { path: "dunning.interest", label: "Verzugszinsen" },
  { path: "dunning.total", label: "Gesamtbetrag Mahnung" },
];

/**
 * Dynamische Platzhalter fuer benutzerdefinierte Kundenfelder (§31): je aktiver
 * CustomFieldDefinition der Organisation ein `customField.<key>`-Eintrag fuer den
 * Vorlagen-Editor. Reine Funktion (kein DB-Zugriff) — der Aufrufer laedt die
 * Definitionen (z. B. `listCustomFieldDefinitions`).
 */
export function customFieldPlaceholders(definitions: { key: string; label: string }[]): { path: string; label: string }[] {
  return definitions.map((d) => ({ path: `customField.${d.key}`, label: d.label }));
}
