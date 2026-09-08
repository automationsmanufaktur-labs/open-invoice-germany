/**
 * Raeumt das Anfrageprotokoll auf (Phase 12d, Task 2): der taegliche Job (Scheduler)
 * wendet je Organisation deren `retentionDays` (Zeit) und `maxRows` (Menge) an. Geloescht
 * wird blockweise — SQLite mag keine riesigen IN-Listen. `orderBy` fuehrt `id` als zweites
 * Kriterium, weil SQLite `createdAt` nur auf Millisekunden genau schreibt: bei Gleichstand
 * waere die Reihenfolge sonst unbestimmt und der Schnitt bei `maxRows` nicht reproduzierbar.
 *
 * Abschluss-Review Fix-Welle (m4/m5, final-review.md):
 * - `groupBy(["orgId"])` (SQL `GROUP BY`) statt `findMany({ distinct: ["orgId"] })` — laut
 *   Prisma-Doku fuehrt `distinct` eine normale SELECT-Abfrage plus IN-MEMORY-Nachbearbeitung
 *   aus (keine echte `SELECT DISTINCT`), der Aufraeumjob haette also EINE Zeile pro
 *   Protokolleintrag gelesen — genau in dem Job, der die unbegrenzt wachsende Tabelle
 *   baendigen soll.
 * - Jede Organisation laeuft in einem eigenen `try/catch`: wirft eine Organisation (z. B.
 *   defekte Einstellungen), bleiben die FOLGENDEN Organisationen in diesem Lauf trotzdem
 *   geraeumt statt komplett zu entfallen (der Scheduler-Runner faengt nur pro Job, nicht
 *   pro Organisation).
 */
import { dbInternal } from "@/lib/db";
import { loadApiSettings } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH_SIZE = 1000;

/** Retention (Zeit + Menge) ueber alle Organisationen; liefert die Anzahl geloeschter Zeilen. */
export async function purgeApiRequestLogs(now: Date = new Date()): Promise<number> {
  const orgs = await dbInternal.apiRequestLog.groupBy({ by: ["orgId"] });
  let deleted = 0;
  for (const { orgId } of orgs) {
    try {
      const { retentionDays, maxRows } = await loadApiSettings(orgId);
      const threshold = new Date(now.getTime() - retentionDays * DAY_MS);

      // Zeit-Retention zuerst — ebenfalls blockweise wie die maxRows-Kuerzung unten
      // (Task-5-Review-Nachtrag): ein einzelnes `deleteMany` ueber sehr viele veraltete
      // Zeilen haette SQLite fuer die Dauer der Loeschung sperren koennen.
      for (;;) {
        const stale = await dbInternal.apiRequestLog.findMany({
          where: { orgId, createdAt: { lt: threshold } },
          take: PURGE_BATCH_SIZE,
          select: { id: true },
        });
        if (stale.length === 0) break;
        deleted += (await dbInternal.apiRequestLog.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } })).count;
        if (stale.length < PURGE_BATCH_SIZE) break;
      }

      // Danach auf maxRows kuerzen — blockweise.
      for (;;) {
        const surplus = await dbInternal.apiRequestLog.findMany({
          where: { orgId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: maxRows,
          take: PURGE_BATCH_SIZE,
          select: { id: true },
        });
        if (surplus.length === 0) break;
        deleted += (await dbInternal.apiRequestLog.deleteMany({ where: { id: { in: surplus.map((r) => r.id) } } })).count;
        if (surplus.length < PURGE_BATCH_SIZE) break;
      }
    } catch (e) {
      // Fehler-Isolation je Organisation (m4): eine defekte Organisation darf die
      // Bereinigung der uebrigen Organisationen in diesem Lauf nicht verhindern.
      console.error(`purgeApiRequestLogs fehlgeschlagen fuer orgId=${orgId}:`, e);
    }
  }
  return deleted;
}

/** Loescht das gesamte Anfrageprotokoll einer Organisation (z.B. beim Deaktivieren). */
export async function clearApiRequestLogs(orgId: string): Promise<number> {
  return (await dbInternal.apiRequestLog.deleteMany({ where: { orgId } })).count;
}
