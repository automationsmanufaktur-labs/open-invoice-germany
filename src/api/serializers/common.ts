/**
 * Gemeinsame Serialisierer-Helfer (Phase 10, Task 2, task-2-facts.md "Serialisierer"):
 * jeder Serialisierer bekommt eine Prisma-Zeile (bzw. eine Domain-Listenzeile) und liefert
 * ein flaches API-Objekt zurueck — NIE `internalNotes`, Geldfelder immer als Integer-Cent
 * mit dem Suffix `Cents` im Feldnamen, Datumsfelder immer ISO 8601 (`toISOString()`),
 * `objectName` je Ressource (Registry aus den Facts) als erstes Feld jedes Objekts.
 */

/** `null` bleibt `null`; ein `Date` wird zu ISO 8601. Nie einen rohen `Date` zurueckgeben. */
export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export interface EmbedOptions {
  embed: Set<string>;
}

/** `embed=customer,lines` (kommagetrennt, whitespace toleriert) — nur die in den Facts
 *  erlaubten Werte (customer, lines, payments, attachments) wirken; unbekannte Werte werden
 *  stillschweigend ignoriert (kein Fehler bei Tippfehlern in einem sonst gueltigen Request). */
export function parseEmbed(searchParams: URLSearchParams): Set<string> {
  const raw = searchParams.get("embed");
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
