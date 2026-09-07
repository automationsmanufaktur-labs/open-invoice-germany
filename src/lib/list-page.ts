/**
 * Fix-Welle Phase 8b (final-review-findings.md B1): die vier Listen-Seiten
 * (/rechnungen, /dokumente, /lieferscheine, /abos) reichten das rohe Next.js
 * `searchParams`-Objekt direkt an listInvoices/listQuotes/listDeliveryNotes/listRecurring
 * durch. `FilterBar` ist ein einfaches `<form method="get">` — jedes Feld wird beim
 * Absenden mitgeschickt, auch leer ("Alle" im Status-<select>). Eine leere Zeichenkette
 * (`status=""`) ist fuer die jeweiligen Zod-Enums kein gueltiger Wert -> ungefangener
 * ZodError in der Server-Component -> Next.js-Fehlerseite beim ersten Klick auf
 * "Filtern". `parseListQuery` (src/lib/list-query.ts) existierte bereits fuer genau
 * diesen Zweck, wurde aber nur von den API-Routen genutzt, nie von den Seiten selbst.
 *
 * `loadListPage` schliesst diese Luecke: parst die Query ueber `parseListQuery`, ruft
 * die Domain-Listenfunktion auf und faengt einen verbleibenden ZodError (z. B.
 * `offset=abc`, `status=foo` bei einer von Hand eingegebenen URL) ab, indem mit den
 * Standardfiltern (nur `extra`, z. B. `includeArchived`) erneut versucht wird — die Seite
 * zeigt dann die Default-Ansicht statt der Next.js-Fehlerseite.
 */
import { z } from "zod";
import { parseListQuery } from "@/lib/list-query";

export type SearchParams = Record<string, string | string[] | undefined>;

export async function loadListPage<T>(
  sp: SearchParams,
  run: (filter: Record<string, unknown>) => Promise<T>,
  options: { booleanKeys?: readonly string[]; extra?: Record<string, unknown> } = {},
): Promise<T> {
  const { booleanKeys = [], extra = {} } = options;
  const raw = { ...parseListQuery(sp, booleanKeys), ...extra };
  try {
    return await run(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return run(extra);
    }
    throw e;
  }
}
