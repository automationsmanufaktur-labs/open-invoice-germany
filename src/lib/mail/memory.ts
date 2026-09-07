/** In-Memory-Provider fuer Tests: sammelt gesendete Mails, kann den naechsten Versand scheitern lassen. */
import type { MailProvider, OutgoingMail } from "./provider";
import { MailSendError } from "./provider";

export function createMemoryProvider(): MailProvider & { sent: OutgoingMail[]; failNext(msg: string): void } {
  const sent: OutgoingMail[] = [];
  let nextFailure: string | null = null;
  return {
    sent,
    failNext(msg: string) {
      nextFailure = msg;
    },
    async send(mail: OutgoingMail) {
      if (nextFailure !== null) {
        const msg = nextFailure;
        nextFailure = null;
        throw new MailSendError(msg);
      }
      sent.push(mail);
      return { providerId: `mem-${sent.length}` };
    },
  };
}
