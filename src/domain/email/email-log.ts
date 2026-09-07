/**
 * Log-Hilfsfunktionen fuer den Mailversand, herausgezogen aus `send.ts` (Phase 3b,
 * Task 2), damit `sendInternalNotification` (src/domain/quote-share/decide.ts) dieselbe
 * Log-/ChangeLog-Logik verwendet wie `sendDocumentEmail` — kein Duplikat.
 *
 * Zwei Schritte, wie im Kommentar von `send.ts` beschrieben: `createQueuedEmailLog` legt
 * das Protokoll VOR dem SMTP-Aufruf mit Status QUEUED an (bei einem Prozessabbruch
 * waehrend des Versands existiert so ein Log); `finishEmailLog` verbucht das Ergebnis
 * NACH dem SMTP-Aufruf in EINER Transaktion mit dem ChangeLog-Eintrag. Kein SMTP-Aufruf
 * innerhalb einer Prisma-Transaktion (SQLite-Sperre).
 */
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { logActivity, type ActivityEntityType } from "@/domain/activity/log";
import { onEmailBounced } from "@/domain/notifications/hooks";

/**
 * Bildet den Mail-Belegtyp (EmailLog.docType — INVOICE/CREDIT_NOTE/DUNNING/ANGEBOT/
 * AUFTRAGSBESTAETIGUNG/PROFORMA/DELIVERY_NOTE) auf den ActivityLog-Entitaetstyp ab.
 * DUNNING liefert `null` — eine Mahnung ist kein eigener ActivityEntityType (INVOICE|
 * QUOTE|DELIVERY_NOTE|CUSTOMER|RECURRING); der Versand einer Mahnung wird stattdessen
 * ueber `DUNNING_SENT` an der Rechnung protokolliert (`src/domain/dunning/send.ts`).
 */
function activityEntityTypeForDocType(docType: string): ActivityEntityType | null {
  if (docType === "INVOICE" || docType === "CREDIT_NOTE") return "INVOICE";
  if (docType === "DELIVERY_NOTE") return "DELIVERY_NOTE";
  if (docType === "ANGEBOT" || docType === "AUFTRAGSBESTAETIGUNG" || docType === "PROFORMA") return "QUOTE";
  return null;
}

export interface CreateQueuedEmailLogInput {
  orgId: string;
  docType: string;
  docId: string;
  templateId?: string | null;
  resendOfId?: string | null;
  fromEmail: string;
  replyTo?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodySnapshot: string;
  attachmentsJson?: string;
  warningsJson?: string;
  sentByUserId: string;
}

/** Legt das EmailLog VOR dem eigentlichen Versand mit Status QUEUED an. */
export async function createQueuedEmailLog(input: CreateQueuedEmailLogInput) {
  return dbInternal.emailLog.create({
    data: {
      orgId: input.orgId,
      docType: input.docType,
      docId: input.docId,
      templateId: input.templateId ?? null,
      resendOfId: input.resendOfId ?? null,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo ?? null,
      toJson: JSON.stringify(input.to),
      ccJson: JSON.stringify(input.cc),
      bccJson: JSON.stringify(input.bcc),
      subject: input.subject,
      bodySnapshot: input.bodySnapshot,
      attachmentsJson: input.attachmentsJson ?? "[]",
      status: "QUEUED",
      warningsJson: input.warningsJson ?? "[]",
      sentByUserId: input.sentByUserId,
    },
  });
}

export interface FinishEmailLogInput {
  orgId: string;
  logId: string;
  status: "SENT" | "FAILED";
  providerId: string | null;
  error?: string | null;
  actor: string;
  /** Fuer den ChangeLog-Diff — dieselbe Form wie bisher in send.ts. */
  docType: string;
  docId: string;
  docNumber?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  attachmentsMeta?: unknown;
  at?: Date;
}

/** Verbucht das Versandergebnis (Update des Logs + ChangeLog EMAIL) in EINER Transaktion. */
export async function finishEmailLog(input: FinishEmailLogInput): Promise<void> {
  const at = input.at ?? new Date();
  await dbInternal.$transaction(async (tx) => {
    await tx.emailLog.update({
      where: { id: input.logId },
      data: {
        status: input.status,
        providerId: input.providerId,
        error: input.error ?? null,
        sentAt: input.status === "SENT" ? at : null,
      },
    });
    await appendChangeLog(tx, {
      orgId: input.orgId,
      entity: "EMAIL",
      entityId: input.logId,
      action: input.status,
      actor: input.actor,
      at,
      diff: {
        docType: input.docType,
        docId: input.docId,
        docNumber: input.docNumber ?? null,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        attachments: input.attachmentsMeta ?? [],
        error: input.error ?? null,
      },
    });

    // EmailLog-Statuswechsel (Task-3-Brief): nur bei erfolgreichem Versand — ACTIVITY_TYPES
    // kennt keinen eigenen "Versand fehlgeschlagen"-Typ, FAILED bleibt im ChangeLog-Eintrag
    // oben nachvollziehbar.
    if (input.status === "SENT") {
      const entityType = activityEntityTypeForDocType(input.docType);
      if (entityType) {
        await logActivity(tx, {
          orgId: input.orgId,
          entityType,
          entityId: input.docId,
          type: "SENT",
          actor: input.actor,
          at,
          data: { subject: input.subject, to: input.to },
        });
      }
    }
  });
}

/**
 * Markiert ein bereits versendetes EmailLog als unzustellbar (BOUNCED). Es gibt aktuell
 * KEINEN Provider-Webhook, der diese Funktion aufruft (kein SMTP-Bounce-Handling ist Teil
 * dieses Programms, siehe Modulkommentar `send.ts`) — die Funktion ist der vorbereitete
 * Einstiegspunkt fuer einen kuenftigen Webhook (Route/Task 4), damit `onEmailBounced`
 * (`src/domain/notifications/hooks.ts`) und die BOUNCED-Aktivitaet dann nicht an zwei
 * Stellen dupliziert werden muessen.
 */
export async function markEmailBounced(orgId: string, logId: string, actor = "system", now: Date = new Date()): Promise<void> {
  const log = await dbInternal.emailLog.findFirst({ where: { id: logId, orgId } });
  if (!log) return;

  await dbInternal.$transaction(async (tx) => {
    await tx.emailLog.update({ where: { id: logId }, data: { status: "BOUNCED" } });
    await appendChangeLog(tx, {
      orgId,
      entity: "EMAIL",
      entityId: logId,
      action: "BOUNCED",
      actor,
      at: now,
      diff: { docType: log.docType, docId: log.docId, to: JSON.parse(log.toJson) as string[] },
    });
    const entityType = activityEntityTypeForDocType(log.docType);
    if (entityType) {
      await logActivity(tx, { orgId, entityType, entityId: log.docId, type: "BOUNCED", actor, at: now });
    }
  });

  const to = (JSON.parse(log.toJson) as string[])[0];
  await onEmailBounced(orgId, { logId, docType: log.docType, docId: log.docId, to });
}
