/**
 * Mahnversand (Phase 6, Task 2) — nutzt dieselbe Vorbelegung/denselben Versandpfad wie der
 * SendEmailDialog (`prefillEmail`/`sendDocumentEmail`), damit kein zweiter, abweichender
 * Mailversand-Code existiert. `sentAt` wird NUR bei Erfolg gesetzt (erlaubter Guard-Pfad
 * fuer `dunning.update`), in derselben Transaktion wie der ChangeLog-Eintrag DUNNING_SEND —
 * der eigentliche SMTP-Versand laeuft bewusst AUSSERHALB jeder Transaktion (siehe send.ts).
 */
import { dbInternal } from "@/lib/db";
import { prefillEmail } from "@/domain/email/compose";
import { sendDocumentEmail, type SendDocumentEmailResult } from "@/domain/email/send";
import { appendChangeLog } from "@/domain/audit";
import { DunningError } from "@/domain/dunning/create";
import type { MailProvider } from "@/lib/mail/provider";

export interface SendDunningOptions {
  actor: string;
  /** Empfaenger explizit ueberschreiben (sonst Vorbelegung aus dem Kundenstamm/Snapshot). */
  to?: string;
  provider?: MailProvider;
}

export async function sendDunning(orgId: string, dunningId: string, opts: SendDunningOptions): Promise<SendDocumentEmailResult> {
  const d = await dbInternal.dunning.findFirst({ where: { id: dunningId, invoice: { orgId } }, select: { id: true, invoiceId: true, number: true } });
  if (!d) throw new DunningError("Mahnung nicht gefunden.");

  const prefill = await prefillEmail(orgId, { docType: "DUNNING", docId: dunningId });
  const to = opts.to ? [opts.to] : prefill.to;
  if (to.length === 0) throw new DunningError("Keine Empfänger-E-Mail-Adresse hinterlegt.");

  const result = await sendDocumentEmail(
    orgId,
    opts.actor,
    {
      docType: "DUNNING",
      docId: dunningId,
      to: to.join(","),
      cc: prefill.cc.join(","),
      bcc: prefill.bcc.join(","),
      subject: prefill.subject,
      body: prefill.body,
      signature: prefill.signature,
      copyToSelf: prefill.copyToSelf,
      standardAttachments: prefill.attachments.map((a) => a.filename),
      templateId: prefill.templateId,
      warnings: prefill.warnings,
      attachmentIds: [],
    },
    [],
    opts.provider,
  );

  if (result.status === "SENT") {
    const now = new Date();
    await dbInternal.$transaction(async (tx) => {
      await tx.dunning.update({ where: { id: dunningId }, data: { sentAt: now } });
      await appendChangeLog(tx, {
        orgId,
        entity: "INVOICE",
        entityId: d.invoiceId,
        action: "DUNNING_SEND",
        actor: opts.actor,
        at: now,
        diff: { dunningId: d.id, number: d.number },
      });
    });
  }

  return result;
}
