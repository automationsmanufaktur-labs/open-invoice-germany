/** SMTP-Provider (nodemailer). Fehlertexte werden von Zugangsdaten bereinigt. */
import nodemailer from "nodemailer";
import type { DecryptedMailSettings } from "@/domain/email/settings";
import { MailSendError, type MailProvider } from "./provider";

export function createSmtpProvider(s: DecryptedMailSettings): MailProvider {
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === "TLS",
    requireTLS: s.security === "STARTTLS",
    ignoreTLS: s.security === "NONE",
    auth: s.username ? { user: s.username, pass: s.password ?? "" } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  return {
    async send(mail) {
      try {
        const info = await transport.sendMail({
          from: { name: mail.from.name, address: mail.from.address },
          to: mail.to,
          cc: mail.cc,
          bcc: mail.bcc,
          replyTo: mail.replyTo,
          subject: mail.subject,
          text: mail.text,
          attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
        });
        return { providerId: info.messageId ?? null };
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        // Bug im Brief-Code korrigiert (Nachtrag): replaceAll("", ...) wuerde zwischen jedem
        // Zeichen einfuegen. Passwort nur ersetzen, wenn eines gesetzt ist.
        const cleaned = s.password ? raw.split(s.password).join("***") : raw;
        throw new MailSendError(cleaned);
      }
    },
  };
}
