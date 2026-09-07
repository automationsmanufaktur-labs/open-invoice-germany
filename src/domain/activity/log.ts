/**
 * Aktivitaetsprotokoll (Phase 8b, Task 3) — GoBD-KEIN Ersatz fuer die ChangeLog-Hash-Kette
 * (Audit K5, `src/domain/audit.ts`): `logActivity` schreibt einen einfachen, unverketteten
 * Eintrag ins `ActivityLog` und speist damit `buildTimeline` (`src/domain/timeline/build.ts`).
 *
 * Ruling (Plan-Header, Global Constraints): ein Fehler in `logActivity` darf das ausloesende
 * Ereignis NIE verhindern — deshalb try/catch um jeden Schreibversuch, Fehler landen nur in
 * `console.error`, nie als geworfene Exception beim Aufrufer. Laeuft innerhalb bestehender
 * Transaktionen mit `tx`, ausserhalb mit `dbInternal` (Task-3-Facts) — `db` nimmt deshalb
 * beide Client-Formen an.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export type ActivityDbClient = Prisma.TransactionClient | PrismaClient;

export type ActivityEntityType = "INVOICE" | "QUOTE" | "DELIVERY_NOTE" | "CUSTOMER" | "RECURRING";

/** Aktivitaetstypen (`ActivityLog.type`) mit deutschem Anzeigetext (Task-3-Brief). */
export const ACTIVITY_TYPES = {
  CREATED: "Erstellt",
  UPDATED: "Bearbeitet",
  FINALIZED: "Festgeschrieben",
  SENT: "Versendet",
  DELIVERED: "Zugestellt",
  BOUNCED: "Unzustellbar",
  PAYMENT_RECORDED: "Zahlung erfasst",
  CANCELLED: "Storniert",
  CREDIT_NOTE_CREATED: "Gutschrift erstellt",
  DUNNING_CREATED: "Mahnung erstellt",
  DUNNING_SENT: "Mahnung versendet",
  DUNNING_STATE: "Mahnstatus geaendert",
  CONVERTED: "Umgewandelt",
  DUPLICATED: "Dupliziert",
  TAKEN_OVER: "Als Vorlage uebernommen",
  ATTACHMENT_ADDED: "Anhang hinzugefuegt",
  ATTACHMENT_REMOVED: "Anhang entfernt",
  STATUS_CHANGED: "Status geaendert",
  SHARE_LINK_CREATED: "Annahme-Link erstellt",
  QUOTE_ACCEPTED: "Angebot angenommen",
  QUOTE_REJECTED: "Angebot abgelehnt",
} as const;

export type ActivityType = keyof typeof ACTIVITY_TYPES;

export interface LogActivityInput {
  orgId: string;
  entityType: ActivityEntityType;
  entityId: string;
  type: ActivityType;
  actor: string;
  at?: Date;
  data?: unknown;
}

/**
 * Schreibt einen Aktivitaetseintrag. Wirft NIE als JS-Exception — ein Fehler (z. B.
 * DB-Ausfall) wird nur geloggt.
 *
 * Fix-Welle (S8, Ruling — Doku statt Umbau): AUSSERHALB einer Transaktion (db =
 * dbInternal) blockiert ein Fehler hier tatsaechlich nie das aufrufende Ereignis. RUFT
 * MAN diese Funktion aber mit `tx` INNERHALB eines `$transaction`-Blocks auf (finalize,
 * payment, status, attachment/manage, dunning/*, recurring/run), gilt das auf Postgres
 * NICHT uneingeschraenkt: ein fehlgeschlagenes SQL-Statement versetzt die Postgres-
 * Transaktion in den Zustand "aborted" — das Abfangen der JS-Exception hier hebt diesen
 * DB-seitigen Abort nicht auf, jeder nachfolgende `tx.*`-Aufruf UND der Commit schlagen
 * dann ebenfalls fehl, das eigentliche Geschaeftsereignis wird also doch blockiert. Das
 * betrifft nur einen echten DB-Fehler beim ActivityLog-Insert (Kontention/Ausfall), nicht
 * den Normalfall. Backlog: ActivityLog-Eintraege nach dem Commit schreiben (auszerhalb der
 * Transaktion), dann gilt die "blockiert nie"-Garantie ausnahmslos.
 */
export async function logActivity(db: ActivityDbClient, input: LogActivityInput): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        actor: input.actor,
        at: input.at ?? new Date(),
        dataJson: input.data !== undefined ? JSON.stringify(input.data) : null,
      },
    });
  } catch (e) {
    console.error("logActivity: Schreiben fehlgeschlagen (Ereignis laeuft unveraendert weiter)", e);
  }
}
