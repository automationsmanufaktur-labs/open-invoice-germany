/**
 * Vor/Zurueck innerhalb der aktuellen Liste (Phase 11d). Die Listen haengen ihre
 * Filter-Query als `?liste=<query>` an jeden Zeilen-Link; die Detailseite laedt mit
 * demselben Filter (ohne Paginierung, max. 200 Zeilen) die Id-Reihenfolge und sucht die
 * Nachbarn. `from` ist als Datumsfilter der Listen belegt, daher der Name `liste`.
 */
import { z } from "zod";
import { listInvoices } from "@/domain/invoice/list";
import { listQuotes, listDeliveryNotes } from "@/domain/document/list";
import { parseListQuery } from "@/lib/list-query";

export type NeighborKind = "INVOICE" | "QUOTE" | "DELIVERY_NOTE";

export interface Neighbors {
  prevId: string | null;
  nextId: string | null;
  /** Bereinigte Query fuer den Zurueck-Link (ohne fuehrendes `?`, ggf. leer). */
  backQuery: string;
}

/** Schluessel, die die drei Listen kennen (FilterBar + Pagination + Archiv-Schalter). */
const ALLOWED_KEYS = new Set(["q", "status", "type", "kind", "from", "to", "offset", "archiviert", "customerId"]);
/** Maximal 200 Zeilen je Listenabfrage (Schema-Maximum der Listenfilter). */
const NEIGHBOR_LIMIT = 200;

// Task-1-Review-Nachtrag (Task 4): `*` ergaenzt — URLSearchParams.toString() (buildListeParam)
// und encodeURIComponent (Zeilen-Link) lassen `*` unescaped, es kommt also literal in der
// liste-Query an (z. B. aus einer Freitextsuche "Foo*"), nicht nur als "%2A".
export const listeQuerySchema = z.string().min(1).max(500).regex(/^[A-Za-z0-9=&%._+*-]*$/);

export function neighborIds(ids: readonly string[], currentId: string): { prevId: string | null; nextId: string | null } {
  const i = ids.indexOf(currentId);
  if (i < 0) return { prevId: null, nextId: null };
  return { prevId: i > 0 ? ids[i - 1] : null, nextId: i < ids.length - 1 ? ids[i + 1] : null };
}

export function parseListeQuery(liste: string | undefined): URLSearchParams | null {
  const parsed = listeQuerySchema.safeParse(liste);
  if (!parsed.success) return null;
  const raw = new URLSearchParams(parsed.data);
  const out = new URLSearchParams();
  for (const [k, v] of raw) if (ALLOWED_KEYS.has(k) && v !== "") out.set(k, v);
  return out;
}

export function buildListeParam(values: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (ALLOWED_KEYS.has(k) && v) p.set(k, v);
  return p.toString();
}

async function orderedIds(kind: NeighborKind, orgId: string, params: URLSearchParams): Promise<string[]> {
  const raw = parseListQuery(params);
  delete raw.offset;
  delete raw.archiviert;
  const includeArchived = params.get("archiviert") === "1";
  const filter = { ...raw, limit: NEIGHBOR_LIMIT, offset: 0 };
  try {
    if (kind === "INVOICE") return (await listInvoices(orgId, filter)).rows.map((r) => r.id);
    if (kind === "QUOTE") return (await listQuotes(orgId, { ...filter, includeArchived })).rows.map((r) => r.id);
    return (await listDeliveryNotes(orgId, { ...filter, includeArchived })).rows.map((r) => r.id);
  } catch (e) {
    if (e instanceof z.ZodError) return [];
    throw e;
  }
}

export async function loadNeighbors(kind: NeighborKind, orgId: string, id: string, liste: string | undefined): Promise<Neighbors> {
  const params = parseListeQuery(liste);
  if (!params) return { prevId: null, nextId: null, backQuery: "" };
  const ids = await orderedIds(kind, orgId, params);
  return { ...neighborIds(ids, id), backQuery: params.toString() };
}
