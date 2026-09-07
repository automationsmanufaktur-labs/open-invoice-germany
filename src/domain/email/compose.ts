/**
 * Vorbelegung eines Versand-Dialogs (Lastenheft 19): Empfaenger, Betreff/Text aus Vorlage
 * gerendert, Standardanhaenge, sowie das erneute Vorbelegen aus einem bestehenden
 * `EmailLog` (Wiederversand).
 */
import { dbInternal } from "@/lib/db";
import { buildTemplateContext, DocumentNotFoundError } from "@/domain/email/context";
import { buildStandardAttachments } from "@/domain/email/attachments";
import { loadMailSettings, MailNotConfiguredError } from "@/domain/email/settings";
import { ensureOrgEmailTemplates } from "@/domain/masterdata/ensure";
import { DEFAULT_DUNNING_STAGES } from "@/domain/masterdata/defaults";
import { renderTemplate } from "@/lib/template/render";
import type { EmailDocType } from "@/schemas/email";

export interface PrefillSource {
  docType: EmailDocType;
  docId: string;
  /** Vorlage explizit waehlen statt Default/Mahnstufen-Logik. */
  templateId?: string;
}

export interface PrefillResult {
  docType: EmailDocType;
  docId: string;
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  signature: string;
  copyToSelf: boolean;
  attachments: { filename: string; size: number }[];
  warnings: string[];
  templateId?: string;
  resendOfId?: string;
  templates: { id: string; name: string }[];
}

/** Wandelt eine kommagetrennte, bereits normalisierte Adressliste (aus MailSettings) in ein Array. */
function splitAddresses(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function templatesOf(orgId: string, docType: EmailDocType) {
  return dbInternal.emailTemplate.findMany({
    where: { orgId, docType },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Waehlt die Vorlage fuer eine Mahnung: Mahnstufe -> emailTemplateId, sonst Standardvorlage
 *  der Stufe (Name aus DEFAULT_DUNNING_STAGES), sonst irgendeine DUNNING-Vorlage. */
async function pickDunningTemplate(orgId: string, docId: string) {
  const d = await dbInternal.dunning.findFirst({
    where: { id: docId, invoice: { orgId } },
    include: { stage: { include: { emailTemplate: true } } },
  });
  if (d?.stage?.emailTemplate) return d.stage.emailTemplate;

  const stageName = DEFAULT_DUNNING_STAGES.find((s) => s.order === d?.level)?.name;
  if (stageName) {
    const byName = await dbInternal.emailTemplate.findFirst({ where: { orgId, docType: "DUNNING", name: stageName } });
    if (byName) return byName;
  }
  return dbInternal.emailTemplate.findFirst({
    where: { orgId, docType: "DUNNING" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

async function pickTemplate(orgId: string, docType: EmailDocType, docId: string, templateId?: string) {
  if (templateId) {
    const explicit = await dbInternal.emailTemplate.findFirst({ where: { id: templateId, orgId, docType } });
    if (explicit) return explicit;
  }
  if (docType === "DUNNING") return pickDunningTemplate(orgId, docId);
  return dbInternal.emailTemplate.findFirst({ where: { orgId, docType, isDefault: true }, orderBy: { createdAt: "asc" } });
}

/** Baut die Vorbelegung entweder aus einem Beleg (docType/docId) oder aus einem
 *  bestehenden Versandprotokoll (logId, fuer den Wiederversand). */
export async function prefillEmail(orgId: string, source: PrefillSource | { logId: string }): Promise<PrefillResult> {
  const settings = await loadMailSettings(orgId);
  if (!settings) throw new MailNotConfiguredError();
  const from = { name: settings.fromName, address: settings.fromEmail };

  if ("logId" in source) {
    // G7: findFirst statt findFirstOrThrow — ein unbekanntes/fremdes logId ist kein
    // Serverfehler, sondern ein regulaerer 404-Fall (Route mappt DocumentNotFoundError).
    const log = await dbInternal.emailLog.findFirst({ where: { id: source.logId, orgId } });
    if (!log) throw new DocumentNotFoundError("Versandprotokoll nicht gefunden");
    const docType = log.docType as EmailDocType;
    const attachments = await buildStandardAttachments(orgId, docType, log.docId);
    return {
      docType,
      docId: log.docId,
      from,
      to: JSON.parse(log.toJson) as string[],
      cc: JSON.parse(log.ccJson) as string[],
      bcc: JSON.parse(log.bccJson) as string[],
      subject: log.subject,
      body: log.bodySnapshot,
      signature: "",
      copyToSelf: settings.copyToSelf,
      attachments: attachments.map((a) => ({ filename: a.filename, size: a.content.length })),
      warnings: [],
      templateId: log.templateId ?? undefined,
      resendOfId: log.id,
      templates: await templatesOf(orgId, docType),
    };
  }

  const { docType, docId, templateId } = source;
  const { ctx, customerEmail } = await buildTemplateContext(orgId, docType, docId);

  let template = await pickTemplate(orgId, docType, docId, templateId);
  if (!template) {
    await ensureOrgEmailTemplates(dbInternal, orgId);
    template = await pickTemplate(orgId, docType, docId, templateId);
  }

  const warnings: string[] = [];
  let subject = "";
  let body = "";
  let signature = "";
  if (template) {
    const subj = renderTemplate(template.subject, ctx);
    const bod = renderTemplate(template.body, ctx);
    subject = subj.text;
    body = bod.text;
    warnings.push(...subj.warnings, ...bod.warnings);
    if (template.signature) {
      const sig = renderTemplate(template.signature, ctx);
      signature = sig.text;
      warnings.push(...sig.warnings);
    }
  }

  const attachments = await buildStandardAttachments(orgId, docType, docId);

  return {
    docType,
    docId,
    from,
    to: customerEmail ? [customerEmail] : [],
    cc: splitAddresses(settings.defaultCc),
    bcc: splitAddresses(settings.defaultBcc),
    subject,
    body,
    signature,
    copyToSelf: settings.copyToSelf,
    attachments: attachments.map((a) => ({ filename: a.filename, size: a.content.length })),
    warnings,
    templateId: template?.id,
    templates: await templatesOf(orgId, docType),
  };
}
