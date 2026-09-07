/** Abstraktion des Mailversands (Lastenheft 19/21) — SMTP- und In-Memory-Implementierung. */
import type { Attachment } from "@/domain/email/attachments";

export interface OutgoingMail {
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  subject: string;
  text: string;
  attachments: Attachment[];
}

export interface MailProvider {
  send(mail: OutgoingMail): Promise<{ providerId: string | null }>;
}

export class MailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailSendError";
  }
}
