/**
 * Versand eines Belegs per E-Mail (Lastenheft 19/21): Protokoll (`EmailLog`) VOR dem
 * SMTP-Aufruf anlegen (Status QUEUED), damit bei einem Prozessabbruch waehrend des
 * Versands ein Log existiert; Ergebnis danach in EINER Transaktion mit dem ChangeLog-
 * Eintrag verbuchen. Kein SMTP-Aufruf innerhalb einer Prisma-Transaktion (SQLite-Sperre).
 *
 * Statuswerte hier nur QUEUED/SENT/FAILED — DELIVERED/BOUNCED setzt kein Provider-Webhook
 * (nicht Teil dieses Programms).
 */
import { createHash } from "node:crypto";
import { dbInternal } from "@/lib/db";
import { buildStandardAttachments, attachmentDocTypeFor, type Attachment } from "@/domain/email/attachments";
import { loadAttachmentForSend } from "@/domain/attachment/manage";
import { buildTemplateContext, DocumentNotFoundError } from "@/domain/email/context";
import { loadMailSettings, MailNotConfiguredError } from "@/domain/email/settings";
import { loadDocumentSettings } from "@/domain/document/settings";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createQueuedEmailLog, finishEmailLog } from "@/domain/email/email-log";
import { setQuoteStatus, setDeliveryNoteStatus } from "@/domain/document/status";
import { createSmtpProvider } from "@/lib/mail/smtp";
import type { MailProvider } from "@/lib/mail/provider";
import { sendEmailInputSchema, type SendEmailRawInput } from "@/schemas/email";
import { MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES } from "@/lib/attachments/mime";

export interface SendDocumentEmailResult {
  logId: string;
  status: "SENT" | "FAILED";
  error?: string;
}

export class EmailAttachmentsTooLargeError extends Error {
  constructor(totalBytes: number) {
    super(`Anhaenge ueberschreiten insgesamt ${MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024)} MB (${(totalBytes / (1024 * 1024)).toFixed(1)} MB).`);
    this.name = "EmailAttachmentsTooLargeError";
  }
}

export async function sendDocumentEmail(
  orgId: string,
  actor: string,
  rawInput: SendEmailRawInput,
  extra: Attachment[],
  provider?: MailProvider,
): Promise<SendDocumentEmailResult> {
  // Die Domain validiert selbst (G5, Lastenheft 55: kein Bypass ueber MCP oder eine
  // zukuenftige zweite Route). Die HTTP-Route parst zusaetzlich fuer eine fruehe 400-
  // Antwort — doppelt ist hier gewollt, massgeblich ist dieser Aufruf.
  const input = sendEmailInputSchema.parse(rawInput);

  const settings = await loadMailSettings(orgId);
  if (!settings) throw new MailNotConfiguredError();
  const prov = provider ?? createSmtpProvider(settings);

  // autoFinalizeOnSend (Phase 7, §33): ein Rechnungsentwurf (INVOICE-Familie:
  // INVOICE/CORRECTION/PARTIAL/DOWNPAYMENT/FINAL/CREDIT_NOTE) wird vor dem Versand
  // automatisch festgeschrieben, wenn die Org-Einstellung aktiv ist. Ein Fehler beim
  // Festschreiben (z. B. fehlende Pflichtangaben) bricht den Versand mit derselben
  // Fehlerklasse ab — VOR jeder Log-Anlage, also ohne Eintrag im EmailLog.
  if (input.docType === "INVOICE" || input.docType === "CREDIT_NOTE") {
    const okTypes = input.docType === "CREDIT_NOTE" ? ["CREDIT_NOTE"] : ["INVOICE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"];
    const inv = await dbInternal.invoice.findFirst({ where: { id: input.docId, orgId, type: { in: okTypes } }, select: { id: true, status: true } });
    if (inv && inv.status === "DRAFT") {
      const docSettings = await loadDocumentSettings(orgId);
      if (docSettings.autoFinalizeOnSend) {
        await finalizeInvoice(input.docId, { actor });
      }
    }
  }

  // shareLinkDefaultOn (Phase 7, §33): Linkerzeugung fuer Angebote wurde nach
  // `resolveOfferLink` (src/domain/email/compose.ts, `prefillEmail`) verschoben — dort
  // entsteht der Text der Mail, ein hier nachtraeglich geminteter Link wuerde den
  // bereits gerenderten {{offer.link}}-Platzhalter (leer oder Zeile entfernt) nicht mehr
  // rueckwirkend befuellen (Fix-Runde 1).

  // Mandanten-Gate: wirft DocumentNotFoundError bei Fremd-Org, falschem Belegtyp oder
  // Nichtexistenz — VOR jeder Log-Anlage. buildStandardAttachments allein reicht nicht,
  // da es bei fremder/erfundener docId still [] liefert statt zu werfen.
  const { docNumber } = await buildTemplateContext(orgId, input.docType, input.docId);

  // G4: templateId/resendOfId auf Existenz UND Mandantenzugehoerigkeit pruefen, bevor
  // ueberhaupt ein Log angelegt wird — verhindert Logs mit toten/fremden Fremdschluesseln.
  if (input.templateId) {
    const tpl = await dbInternal.emailTemplate.findFirst({ where: { id: input.templateId, orgId }, select: { id: true } });
    if (!tpl) throw new DocumentNotFoundError("Vorlage nicht gefunden");
  }
  if (input.resendOfId) {
    const resendOf = await dbInternal.emailLog.findFirst({ where: { id: input.resendOfId, orgId }, select: { id: true } });
    if (!resendOf) throw new DocumentNotFoundError("Versandprotokoll nicht gefunden");
  }

  const std = await buildStandardAttachments(orgId, input.docType, input.docId);
  // Zusaetzliche Beleganhaenge (Phase 4b, DocumentAttachment) — org- und beleggeprueft
  // ueber loadAttachmentForSend, damit keine fremde/erfundene id einen Anhang eines
  // anderen Belegs oder einer anderen Organisation mitversendet (Lastenheft §38).
  const stored = await loadAttachmentForSend(orgId, attachmentDocTypeFor(input.docType), input.docId, input.attachmentIds);
  const attachments = [...std.filter((a) => input.standardAttachments.includes(a.filename)), ...stored, ...extra];

  // G3: die Send-Route prueft nur die Zusatzanhaenge (extra) frueh gegen 20 MB — Standard-
  // (PDF/XML) und Beleganhaenge kommen erst HIER dazu. Massgeblich fuer den tatsaechlichen
  // Versand ist deshalb die Gesamtgroesse ALLER Anhaenge, VOR dem Anlegen des EmailLog.
  const attachmentsTotalBytes = attachments.reduce((sum, a) => sum + a.content.length, 0);
  if (attachmentsTotalBytes > MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES) {
    throw new EmailAttachmentsTooLargeError(attachmentsTotalBytes);
  }

  const bcc = input.copyToSelf && !input.bcc.includes(settings.fromEmail) ? [...input.bcc, settings.fromEmail] : input.bcc;
  const text = input.signature.trim() ? `${input.body}\n\n${input.signature}` : input.body;

  const attachmentsMeta = attachments.map((a) => ({
    filename: a.filename,
    size: a.content.length,
    sha256: createHash("sha256").update(a.content).digest("hex"),
  }));

  const log = await createQueuedEmailLog({
    orgId,
    docType: input.docType,
    docId: input.docId,
    templateId: input.templateId ?? null,
    resendOfId: input.resendOfId ?? null,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo ?? null,
    to: input.to,
    cc: input.cc,
    bcc,
    subject: input.subject,
    bodySnapshot: text,
    attachmentsJson: JSON.stringify(attachmentsMeta),
    warningsJson: JSON.stringify(input.warnings),
    sentByUserId: actor,
  });

  let status: "SENT" | "FAILED" = "SENT";
  let providerId: string | null = null;
  let error: string | undefined;
  try {
    const res = await prov.send({
      from: { name: settings.fromName, address: settings.fromEmail },
      to: input.to,
      cc: input.cc,
      bcc,
      replyTo: settings.replyTo ?? undefined,
      subject: input.subject,
      text,
      attachments,
    });
    providerId = res.providerId;
  } catch (e) {
    status = "FAILED";
    error = e instanceof Error ? e.message.slice(0, 500) : "Unbekannter Fehler";
  }

  await finishEmailLog({
    orgId,
    logId: log.id,
    status,
    providerId,
    error: error ?? null,
    actor,
    docType: input.docType,
    docId: input.docId,
    docNumber,
    to: input.to,
    cc: input.cc,
    bcc,
    subject: input.subject,
    attachmentsMeta,
  });

  // SENT-Hook (Addendum Task 4): erfolgreicher Versand setzt bei Angebot/AB/Proforma
  // (Status DRAFT/EXPIRED) bzw. Lieferschein (Status CREATED) automatisch SENT. Laeuft
  // BEWUSST nach der obigen Transaktion und darf den bereits protokollierten Mailversand
  // nie rueckabwickeln — ein Fehler hier wird nur geloggt, nie geworfen.
  if (status === "SENT") {
    try {
      if (input.docType === "ANGEBOT" || input.docType === "AUFTRAGSBESTAETIGUNG" || input.docType === "PROFORMA") {
        const q = await dbInternal.quote.findFirst({ where: { id: input.docId, orgId }, select: { status: true } });
        if (q && (q.status === "DRAFT" || q.status === "EXPIRED")) {
          await setQuoteStatus(orgId, input.docId, "SENT", { actor });
        }
      } else if (input.docType === "DELIVERY_NOTE") {
        const dn = await dbInternal.deliveryNote.findFirst({ where: { id: input.docId, orgId }, select: { status: true } });
        if (dn && dn.status === "CREATED") {
          await setDeliveryNoteStatus(orgId, input.docId, "SENT", { actor });
        }
      }
    } catch (e) {
      console.warn("sendDocumentEmail: SENT-Statuswechsel nach Versand fehlgeschlagen", e);
    }
  }

  return { logId: log.id, status, error };
}
