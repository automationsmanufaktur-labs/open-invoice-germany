/**
 * Vorlagenverwaltung (Lastenheft 17): Anlegen/Aktualisieren einer E-Mail-Vorlage.
 * `docType` ist nach dem Anlegen unveraendlich — bei einer Aktualisierung wird der
 * Wert serverseitig aus dem bestehenden Datensatz uebernommen, unabhaengig davon, was
 * der Aufrufer (Formular/API) mitschickt. Der clientseitige Schreibschutz im Formular
 * ist nur UX; diese Funktion ist die eigentliche Durchsetzung.
 */
import { dbInternal } from "@/lib/db";
import { emailTemplateInputSchema, type EmailTemplateInput, type EmailDocType } from "@/schemas/email";
import { Prisma, type EmailTemplate } from "@/generated/prisma/client";

export class TemplateNotFoundError extends Error {}
/** Systemvorlage ist die einzige Standardvorlage ihres Dokumenttyps — Loeschen wuerde
 *  den Dokumenttyp ohne jede Vorlage zurueckwerfen (ensureOrgEmailTemplates legt sie
 *  beim naechsten Aufruf zwar neu an, aber erst nach einem Zwischenzustand ohne Vorlage). */
export class SystemTemplateProtectedError extends Error {}
/** orgId/docType/name ist eindeutig (G6) — statt des rohen Prisma-P2002-Fehlertexts eine
 *  fuer Anwender verstaendliche Meldung. */
export class TemplateNameConflictError extends Error {}

/** Legt eine Vorlage an oder aktualisiert sie. Wird `isDefault` gesetzt, werden alle
 *  anderen Vorlagen desselben Dokumenttyps in derselben Transaktion auf `false` gesetzt. */
export async function saveEmailTemplate(orgId: string, rawInput: EmailTemplateInput): Promise<EmailTemplate> {
  const input = emailTemplateInputSchema.parse(rawInput);

  try {
    return await saveEmailTemplateTx(orgId, input);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new TemplateNameConflictError("Es gibt bereits eine Vorlage dieses Namens für diesen Dokumenttyp.");
    }
    throw e;
  }
}

async function saveEmailTemplateTx(orgId: string, input: EmailTemplateInput): Promise<EmailTemplate> {
  return dbInternal.$transaction(async (tx) => {
    let templateId = input.id;
    let docType: EmailDocType = input.docType;

    if (templateId) {
      const existing = await tx.emailTemplate.findFirst({ where: { id: templateId, orgId } });
      if (!existing) throw new Error("Vorlage nicht gefunden.");
      // docType ist unveraenderlich: der bestehende Wert gewinnt, der Eingabewert wird ignoriert.
      docType = existing.docType as EmailDocType;
      await tx.emailTemplate.update({
        where: { id: templateId },
        data: {
          name: input.name,
          subject: input.subject,
          body: input.body,
          signature: input.signature ?? null,
          isDefault: input.isDefault,
        },
      });
    } else {
      const created = await tx.emailTemplate.create({
        data: {
          orgId,
          docType,
          name: input.name,
          subject: input.subject,
          body: input.body,
          signature: input.signature ?? null,
          isDefault: input.isDefault,
        },
      });
      templateId = created.id;
    }

    if (input.isDefault) {
      await tx.emailTemplate.updateMany({
        where: { orgId, docType, id: { not: templateId } },
        data: { isDefault: false },
      });
    }

    return tx.emailTemplate.findUniqueOrThrow({ where: { id: templateId } });
  });
}

/**
 * Loescht eine Vorlage (Lastenheft 17). Eine Systemvorlage darf nur geloescht werden,
 * wenn fuer denselben Dokumenttyp bereits eine ANDERE Vorlage als Standard markiert ist.
 * War die geloeschte Vorlage selbst Standard, wird in DERSELBEN Transaktion eine
 * verbleibende Vorlage desselben Dokumenttyps zum neuen Standard gemacht — bevorzugt die
 * Systemvorlage, sonst die aelteste (W1). Ohne verbleibende Vorlage bleibt der Dokumenttyp
 * ohne Default; `ensureOrgEmailTemplates` heilt das beim naechsten Aufruf.
 */
export async function deleteEmailTemplate(orgId: string, id: string): Promise<void> {
  await dbInternal.$transaction(async (tx) => {
    const tpl = await tx.emailTemplate.findFirst({ where: { id, orgId } });
    if (!tpl) throw new TemplateNotFoundError("Vorlage nicht gefunden.");

    if (tpl.isSystem) {
      const otherDefault = await tx.emailTemplate.count({
        where: { orgId, docType: tpl.docType, isDefault: true, id: { not: tpl.id } },
      });
      if (otherDefault === 0) {
        throw new SystemTemplateProtectedError(
          "Systemvorlage kann nicht gelöscht werden: keine andere Standardvorlage für diesen Dokumenttyp vorhanden.",
        );
      }
    }

    await tx.emailTemplate.delete({ where: { id: tpl.id } });

    if (tpl.isDefault) {
      const successor = await tx.emailTemplate.findFirst({
        where: { orgId, docType: tpl.docType },
        orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
      });
      if (successor) {
        await tx.emailTemplate.update({ where: { id: successor.id }, data: { isDefault: true } });
      }
    }
  });
}
