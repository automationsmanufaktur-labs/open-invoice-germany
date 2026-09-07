/**
 * Wandelt Query-Parameter (URLSearchParams einer GET-Route oder das Next.js
 * `searchParams`-Objekt einer Server-Component) in ein Rohobjekt fuer die
 * Listen-Filterschemata (Phase 8b, Task 1: invoiceListFilterSchema/quoteListFilterSchema/
 * deliveryNoteListFilterSchema/recurringListFilterSchema) um. Die meisten Felder bleiben
 * Strings — die jeweiligen `z.coerce.*`-Definitionen parsen sie selbst. `booleanKeys`
 * (z. B. `eInvoice`, das bewusst KEIN `.coerce` traegt) werden explizit von
 * "true"/"false"-Strings in echte Booleans uebersetzt.
 *
 * Leere Query-Werte (z. B. ein FilterBar-<select> mit der Option "Alle") werden
 * verworfen, damit der jeweilige Zod-`.default()` greift statt an einer leeren
 * Zeichenkette zu scheitern (z. B. `status=` waere sonst kein gueltiger Enum-Wert).
 */
export function parseListQuery(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
  booleanKeys: readonly string[] = [],
): Record<string, unknown> {
  const entries: [string, string][] =
    input instanceof URLSearchParams
      ? [...input.entries()]
      : Object.entries(input).flatMap(([k, v]): [string, string][] => {
          if (v == null) return [];
          return Array.isArray(v) ? v.map((x): [string, string] => [k, x]) : [[k, v]];
        });

  const obj: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (v === "") continue;
    obj[k] = booleanKeys.includes(k) ? (v === "true" ? true : v === "false" ? false : v) : v;
  }
  return obj;
}
