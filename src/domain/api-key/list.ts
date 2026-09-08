/** Auflistung der API-Schluessel einer Organisation (Phase 10, Task 1) — ohne Token/Hash. */
import { dbInternal } from "@/lib/db";
import type { ApiKeyScope } from "@/schemas";

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ListApiKeysResult {
  rows: ApiKeySummary[];
  total: number;
}

function toSummary(r: { id: string; name: string; prefix: string; scopesJson: string; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }): ApiKeySummary {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopesJson.split(",").filter(Boolean) as ApiKeyScope[],
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  };
}

/**
 * Fix-Welle (Nit 14): vorher lud diese Funktion ALLE Zeilen der Organisation und
 * paginierte erst danach in der Route (`.slice(offset, offset+limit)`) — bei vielen
 * Schluesseln unnoetiger Speicher-/Netzwerk-Overhead. `take`/`skip` + `count` (analog
 * src/domain/attachment/list.ts) laesst die Datenbank paginieren.
 */
export async function listApiKeys(orgId: string, opts: { limit: number; offset: number }): Promise<ListApiKeysResult> {
  const where = { orgId };
  const [total, rows] = await Promise.all([
    dbInternal.apiKey.count({ where }),
    dbInternal.apiKey.findMany({ where, orderBy: { createdAt: "desc" }, skip: opts.offset, take: opts.limit }),
  ]);
  return { rows: rows.map(toSummary), total };
}
