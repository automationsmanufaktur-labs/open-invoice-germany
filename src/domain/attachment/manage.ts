/**
 * Beleganhaenge (Phase 4b, Lastenheft §38): Anlage/Entfernung/Auflistung, jeweils
 * org- UND belegzugehoerigkeits-geprueft (assertDocExists, src/domain/relations.ts).
 *
 * Kein GoBD-Beleg (Anhaenge sind loeschbar) — die Kopplung an die Hash-Kette (ChangeLog)
 * ist trotzdem gewuenscht (Auftrag Task 3): ADD/REMOVE werden protokolliert, aber ohne
 * Unveraenderbarkeitsanspruch auf die Datei selbst.
 *
 * Datei-IO (storeFile) laeuft bewusst AUSSERHALB der Prisma-Transaktion — analog
 * sendDocumentEmail (kein Netz-/Dateisystemaufruf innerhalb einer SQLite-Sperre).
 */
import { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { assertDocExists } from "@/domain/relations";
import { NotFoundError } from "@/domain/errors";
import { attachmentUploadSchema, DocRefType } from "@/schemas";
import { storeFile, readFile, deleteFileIfUnreferenced } from "@/lib/attachments/storage";
import { MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC } from "@/lib/attachments/mime";
import type { z } from "zod";
import type { DocumentAttachment } from "@/generated/prisma/client";

export type AttachmentDocType = z.infer<typeof DocRefType>;

export interface AddAttachmentFile {
  filename: string;
  mime: string;
  buffer: Buffer;
}

export interface AttachmentForSend {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Fuegt einem Beleg einen Anhang hinzu. Prueft Belegzugehoerigkeit (org+doc), Whitelist/
 * Groesse (Zod, attachmentUploadSchema), das 50-MB-Limit je Beleg und (ueber storeFile)
 * Magic-Bytes + Dateiendung. Dedup per SHA-256: existiert fuer DIESEN Beleg bereits ein
 * Anhang mit identischem Inhalt, wird die bestehende Zeile unveraendert zurueckgegeben
 * (idempotent, kein zweiter ChangeLog-Eintrag) statt die Unique-Constraint zu verletzen.
 */
export async function addAttachment(
  orgId: string,
  docType: AttachmentDocType,
  docId: string,
  file: AddAttachmentFile,
  actor: string,
): Promise<DocumentAttachment> {
  await assertDocExists(dbInternal, orgId, docType, docId);

  const parsed = attachmentUploadSchema.parse({ filename: file.filename, mime: file.mime, sizeBytes: file.buffer.length });

  const existing = await dbInternal.documentAttachment.findMany({ where: { orgId, docType, docId } });
  const existingTotal = existing.reduce((sum, a) => sum + a.sizeBytes, 0);
  if (existingTotal + parsed.sizeBytes > MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC) {
    throw new Error(`Anhaenge ueberschreiten insgesamt ${MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC / (1024 * 1024)} MB je Beleg.`);
  }

  // storeFile prueft Magic-Bytes/Endung und wirft AttachmentValidationError bei Ablehnung.
  const stored = await storeFile(orgId, file.buffer, parsed.mime, parsed.filename);

  const dupe = existing.find((a) => a.sha256 === stored.sha256);
  if (dupe) return dupe;

  const now = new Date();
  // G4: zwei gleichzeitige Uploads desselben Inhalts fuer denselben Beleg koennen BEIDE
  // die obige find()-Pruefung ohne Treffer passieren (kein Row-Lock zwischen Lesen und
  // Schreiben) — der zweite create() verletzt dann die Unique-Constraint
  // (orgId, sha256, docType, docId). Statt den Fehler durchzureichen, wird idempotent
  // die inzwischen vom Gewinner angelegte Zeile geladen und zurueckgegeben (wie beim
  // regulaeren Dedup-Fall oben).
  try {
    return await dbInternal.$transaction(async (tx) => {
      const row = await tx.documentAttachment.create({
        data: {
          orgId,
          docType,
          docId,
          filename: parsed.filename,
          mime: parsed.mime,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          storagePath: stored.storagePath,
          uploadedBy: actor,
        },
      });
      await appendChangeLog(tx, {
        orgId,
        entity: "ATTACHMENT",
        entityId: row.id,
        action: "ADD",
        actor,
        at: now,
        diff: { filename: row.filename, sizeBytes: row.sizeBytes, sha256: row.sha256, docType, docId },
      });
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await dbInternal.documentAttachment.findFirst({ where: { orgId, sha256: stored.sha256, docType, docId } });
      if (winner) return winner;
    }
    throw e;
  }
}

/**
 * Entfernt einen Anhang von einem Beleg. Loescht die physische Datei nur, wenn keine
 * andere DocumentAttachment-Zeile (auch ueber Belege/Organisationen hinweg) denselben
 * storagePath referenziert.
 */
export async function removeAttachment(orgId: string, docType: AttachmentDocType, docId: string, attachmentId: string, actor: string): Promise<void> {
  const row = await dbInternal.documentAttachment.findFirst({ where: { id: attachmentId, orgId, docType, docId } });
  if (!row) throw new NotFoundError(`Anhang ${attachmentId} nicht gefunden.`);

  const now = new Date();
  await dbInternal.$transaction(async (tx) => {
    await tx.documentAttachment.delete({ where: { id: row.id } });
    await appendChangeLog(tx, {
      orgId,
      entity: "ATTACHMENT",
      entityId: row.id,
      action: "REMOVE",
      actor,
      at: now,
      diff: { filename: row.filename, sizeBytes: row.sizeBytes, sha256: row.sha256, docType, docId },
    });
  });

  await deleteFileIfUnreferenced(row.storagePath, async (storagePath) => {
    const count = await dbInternal.documentAttachment.count({ where: { storagePath } });
    return count > 0;
  });
}

/** Listet die Anhaenge eines Belegs, org- und belegzugehoerigkeits-geprueft. */
export async function listAttachments(orgId: string, docType: AttachmentDocType, docId: string): Promise<DocumentAttachment[]> {
  await assertDocExists(dbInternal, orgId, docType, docId);
  return dbInternal.documentAttachment.findMany({ where: { orgId, docType, docId }, orderBy: { createdAt: "asc" } });
}

/**
 * Laedt ausgewaehlte Beleganhaenge fuer den Mailversand (src/domain/email/send.ts) —
 * org- UND beleggeprueft: jede id MUSS zu genau diesem (orgId, docType, docId) gehoeren,
 * sonst wird verworfen statt still gefiltert (fremde/erfundene IDs sind ein Fehler, kein
 * regulaerer Fall).
 */
export async function loadAttachmentForSend(orgId: string, docType: AttachmentDocType, docId: string, ids: readonly string[]): Promise<AttachmentForSend[]> {
  if (ids.length === 0) return [];
  const uniqueIds = [...new Set(ids)];
  const rows = await dbInternal.documentAttachment.findMany({ where: { id: { in: uniqueIds }, orgId, docType, docId } });
  if (rows.length !== uniqueIds.length) {
    throw new NotFoundError("Ein oder mehrere Beleganhaenge wurden nicht gefunden oder gehoeren nicht zu diesem Beleg.");
  }
  return Promise.all(rows.map(async (r) => ({ filename: r.filename, contentType: r.mime, content: await readFile(r.storagePath) })));
}
