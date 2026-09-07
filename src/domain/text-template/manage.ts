/**
 * Verwaltung der Dokumenttextvorlagen (Kopf-/Fusstext, Bedingungen) durch den Nutzer:
 * anlegen/aendern, loeschen, als Standard setzen. Analog zu src/domain/email/templates.ts,
 * aber ohne eigenes `isSystem`-Feld am Modell — als "Systemvorlage" gilt hier die von
 * ensureOrgTextTemplates angelegte Vorlage mit dem Namen "Standard" (siehe defaults.ts).
 */
import { Prisma } from "@/generated/prisma/client";
import type { TextTemplate } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { textTemplateInputSchema, type TextTemplateInput } from "@/schemas";
import { DEFAULT_TEXT_TEMPLATES } from "./defaults";

export class TemplateNotFoundError extends Error {}
/** Die Systemvorlage (Name "Standard") ist die letzte Vorlage ihrer (docType, position)
 *  -Kombination — Loeschen wuerde die Kombination ohne jede Vorlage zurueckwerfen. */
export class SystemTemplateProtectedError extends Error {}
/** orgId/docType/position/name ist eindeutig — statt des rohen Prisma-P2002-Fehlertexts
 *  eine fuer Anwender verstaendliche Meldung. */
export class TemplateNameConflictError extends Error {}

const SYSTEM_TEMPLATE_NAME = "Standard";
const SYSTEM_COMBOS = new Set(DEFAULT_TEXT_TEMPLATES.map((t) => `${t.docType}|${t.position}`));

function isSystemTemplate(t: { name: string; docType: string; position: string }): boolean {
  return t.name === SYSTEM_TEMPLATE_NAME && SYSTEM_COMBOS.has(`${t.docType}|${t.position}`);
}

/** Legt eine Vorlage an oder aktualisiert sie. Wird `isDefault` gesetzt, werden alle
 *  anderen Vorlagen derselben (docType, position)-Kombination in derselben Transaktion
 *  auf `false` gesetzt. */
export async function saveTextTemplate(orgId: string, rawInput: unknown): Promise<TextTemplate> {
  const input: TextTemplateInput = textTemplateInputSchema.parse(rawInput);

  try {
    return await dbInternal.$transaction(async (tx) => {
      let docType = input.docType;
      let position = input.position;

      if (input.id) {
        const existing = await tx.textTemplate.findFirst({ where: { id: input.id, orgId } });
        if (!existing) throw new TemplateNotFoundError("Vorlage nicht gefunden.");
        // docType/position sind unveraenderlich: der bestehende Wert gewinnt.
        docType = existing.docType as TextTemplateInput["docType"];
        position = existing.position as TextTemplateInput["position"];

        if (input.isDefault) {
          await tx.textTemplate.updateMany({ where: { orgId, docType, position }, data: { isDefault: false } });
        }
        return tx.textTemplate.update({
          where: { id: input.id },
          data: { name: input.name, body: input.body, isDefault: input.isDefault },
        });
      }

      if (input.isDefault) {
        await tx.textTemplate.updateMany({ where: { orgId, docType, position }, data: { isDefault: false } });
      }
      return tx.textTemplate.create({
        data: { orgId, docType, position, name: input.name, body: input.body, isDefault: input.isDefault },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new TemplateNameConflictError("Es gibt bereits eine Vorlage dieses Namens fuer Dokumenttyp und Position.");
    }
    throw e;
  }
}

/** Loescht eine Vorlage. Eine Systemvorlage (Name "Standard") darf nur geloescht werden,
 *  wenn fuer dieselbe (docType, position)-Kombination bereits eine ANDERE Vorlage als
 *  Standard markiert ist. War die geloeschte Vorlage Standard, wird in derselben
 *  Transaktion eine verbleibende Vorlage zum neuen Standard (aelteste zuerst). */
export async function deleteTextTemplate(orgId: string, id: string): Promise<void> {
  await dbInternal.$transaction(async (tx) => {
    const tpl = await tx.textTemplate.findFirst({ where: { id, orgId } });
    if (!tpl) throw new TemplateNotFoundError("Vorlage nicht gefunden.");

    if (isSystemTemplate(tpl)) {
      const otherDefault = await tx.textTemplate.count({
        where: { orgId, docType: tpl.docType, position: tpl.position, isDefault: true, id: { not: tpl.id } },
      });
      if (otherDefault === 0) {
        throw new SystemTemplateProtectedError(
          "Systemvorlage kann nicht geloescht werden: keine andere Standardvorlage fuer diesen Dokumenttyp/diese Position vorhanden.",
        );
      }
    }

    await tx.textTemplate.delete({ where: { id: tpl.id } });

    if (tpl.isDefault) {
      const successor = await tx.textTemplate.findFirst({
        where: { orgId, docType: tpl.docType, position: tpl.position },
        orderBy: { createdAt: "asc" },
      });
      if (successor) {
        await tx.textTemplate.update({ where: { id: successor.id }, data: { isDefault: true } });
      }
    }
  });
}

/** Setzt eine Vorlage als Standard fuer ihre (docType, position)-Kombination; alle
 *  anderen Vorlagen derselben Kombination werden in derselben Transaktion auf
 *  `isDefault = false` gesetzt. */
export async function setDefaultTextTemplate(orgId: string, id: string): Promise<void> {
  await dbInternal.$transaction(async (tx) => {
    const tpl = await tx.textTemplate.findFirst({ where: { id, orgId } });
    if (!tpl) throw new TemplateNotFoundError("Vorlage nicht gefunden.");
    await tx.textTemplate.updateMany({ where: { orgId, docType: tpl.docType, position: tpl.position }, data: { isDefault: false } });
    await tx.textTemplate.update({ where: { id: tpl.id }, data: { isDefault: true } });
  });
}
