/** Widerruf eines API-Schluessels (Phase 10, Task 1) — org-gescoped, idempotent. */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { logActivity } from "@/domain/activity/log";

export async function revokeApiKey(orgId: string, id: string, actor = "system"): Promise<void> {
  const row = await dbInternal.apiKey.findFirst({ where: { id, orgId } });
  if (!row) throw new NotFoundError(`API-Schluessel "${id}" nicht gefunden.`);
  if (row.revokedAt) return; // bereits widerrufen -> idempotent, kein Fehler
  await dbInternal.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  // Fix-Welle (Should-fix 6): Widerruf eines Credentials genauso protokollieren wie die
  // Anlage (create.ts) — NIE Token/Hash, nur Name/Praefix/Scopes.
  await logActivity(dbInternal, {
    orgId,
    entityType: "API_KEY",
    entityId: row.id,
    type: "REVOKED",
    actor,
    data: { name: row.name, prefix: row.prefix, scopes: row.scopesJson.split(",").filter(Boolean) },
  });
}
