/**
 * Idempotenz fuer schreibende /api/v1/*-Aktionen (Phase 10, Task 1 + Fix-Runde 1
 * S1). Header `Idempotency-Key` (nur POST, 1..128 Zeichen). requestHash =
 * sha256(method+path+body).
 *
 * Reserve-First-Zustandsmaschine (Fix-Runde 1 — behebt einen Wettlauf: zwei
 * gleichzeitige, identische Requests konnten beide den Handler ausfuehren, weil
 * der urspruengliche "lesen, dann am Ende schreiben"-Ablauf keine Sperre hatte):
 *
 *   1. `beginIdempotency` versucht, die Zeile ANZULEGEN (status=IN_PROGRESS,
 *      responseJson=null) — abgesichert durch `@@unique([orgId, key])`. Gelingt
 *      das, ist der Aufrufer der EINZIGE, der den Handler ausfuehren darf (liefert
 *      `null`).
 *   2. Schlaegt das Anlegen mit P2002 fehl, existiert bereits eine Zeile fuer
 *      denselben Schluessel:
 *        - abgelaufen (>24h, gilt fuer BEIDE Zustaende) -> loeschen, erneut
 *          versuchen (rekursiv) — Retry nach TTL ist ein Neuanfang.
 *        - `requestHash` weicht ab -> `IdempotencyConflictError` (409
 *          IDEMPOTENCY_MISMATCH).
 *        - `status === "DONE"` -> gespeicherte Antwort zurueckgeben (Replay).
 *        - `status === "IN_PROGRESS"` -> `IdempotencyInProgressError` (409
 *          IDEMPOTENCY_IN_PROGRESS) — der urspruengliche Request laeuft noch.
 *   3. Nach dem Handler: `completeIdempotency` (Status < 500) schreibt
 *      responseJson/statusCode und setzt status=DONE — spaetere identische
 *      Requests replizieren jetzt deterministisch. Bei Status >= 500 ODER wenn
 *      der Handler wirft, entfernt `abandonIdempotency` die Reservierung wieder
 *      (`src/api/auth.ts`), damit ein Retry mit demselben Key normal laeuft
 *      (transiente Fehler duerfen erneut versucht werden — GoBD verlangt keine
 *      Replikation eines Serverfehlers).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyInProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyInProgressError";
  }
}

const TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotentReplay {
  status: number;
  body: unknown;
}

function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function hashIdempotentRequest(method: string, path: string, rawBody: string): string {
  return createHash("sha256").update(`${method}\n${path}\n${rawBody}`, "utf8").digest("hex");
}

/**
 * Reserviert `key` fuer den aktuellen Request (Reserve-First). Liefert `null`,
 * wenn die Reservierung gelang — der Aufrufer fuehrt den Handler aus und ruft
 * danach `completeIdempotency`/`abandonIdempotency`. Liefert eine gespeicherte
 * Antwort (Replay), wenn `key` bereits mit demselben Request abgeschlossen wurde.
 * Wirft `IdempotencyConflictError` bei abweichendem Request, `IdempotencyInProgressError`,
 * wenn der urspruengliche Request noch laeuft.
 */
export async function beginIdempotency(orgId: string, key: string, method: string, path: string, rawBody: string): Promise<IdempotentReplay | null> {
  const requestHash = hashIdempotentRequest(method, path, rawBody);

  try {
    await dbInternal.apiIdempotency.create({
      data: { orgId, key, requestHash, status: "IN_PROGRESS", responseJson: null, statusCode: null },
    });
    return null; // Reservierung gelungen — Aufrufer fuehrt den Handler aus.
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
  }

  const existing = await dbInternal.apiIdempotency.findUnique({ where: { orgId_key: { orgId, key } } });
  if (!existing) {
    // Wettlauf: die Zeile wurde zwischen dem gescheiterten create() und diesem
    // Lesen bereits wieder geloescht (abandonIdempotency eines anderen Requests) —
    // erneut versuchen, die Reservierung zu uebernehmen.
    return beginIdempotency(orgId, key, method, path, rawBody);
  }

  if (Date.now() - existing.createdAt.getTime() > TTL_MS) {
    // Abgelaufen (gilt fuer IN_PROGRESS wie DONE): loeschen, erneut versuchen —
    // der Aufrufer startet einen frischen Zyklus fuer diesen Schluessel.
    await dbInternal.apiIdempotency.delete({ where: { orgId_key: { orgId, key } } }).catch(() => {});
    return beginIdempotency(orgId, key, method, path, rawBody);
  }

  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError(`Idempotency-Key "${key}" wurde bereits mit einem abweichenden Request verwendet.`);
  }

  if (existing.status === "DONE") {
    return { status: existing.statusCode!, body: JSON.parse(existing.responseJson!) as unknown };
  }

  throw new IdempotencyInProgressError("Anfrage mit diesem Idempotency-Key wird gerade verarbeitet");
}

/** Schliesst die Reservierung erfolgreich ab (status=DONE) — spaetere identische Requests replizieren diese Antwort. */
export async function completeIdempotency(orgId: string, key: string, status: number, body: unknown): Promise<void> {
  const responseJson = JSON.stringify(body ?? null);
  await dbInternal.apiIdempotency.update({
    where: { orgId_key: { orgId, key } },
    data: { status: "DONE", statusCode: status, responseJson },
  });
}

/** Entfernt eine IN_PROGRESS-Reservierung wieder (Handler warf oder lieferte 5xx) — ein Retry mit demselben Key laeuft danach normal. */
export async function abandonIdempotency(orgId: string, key: string): Promise<void> {
  await dbInternal.apiIdempotency.delete({ where: { orgId_key: { orgId, key } } }).catch(() => {});
}
