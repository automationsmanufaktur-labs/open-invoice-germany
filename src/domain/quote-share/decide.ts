/**
 * Online-Entscheidung ueber ein Angebot (Phase 3b, Task 2): Annahme/Ablehnung per
 * Angebotslink, transaktional mit Statuswechsel + Link-Update + ChangeLog (GoBD,
 * Lastenheft 50). Automatik (AB/Rechnung) und interne Benachrichtigung laufen bewusst
 * NACH der Entscheidungs-Transaktion — `convertDocument` oeffnet eine eigene Transaktion,
 * ein Fehler dort darf die bereits verbuchte Entscheidung nicht zuruecknehmen.
 */
import { dbInternal } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { appendChangeLog } from "@/domain/audit";
import { rateLimit } from "@/lib/rate-limit";
import { hashToken } from "@/domain/quote-share/token";
import { resolveShareLinkForDecision } from "@/domain/quote-share/link";
import { setQuoteStatusWithinTx } from "@/domain/document/status";
import { loadDocumentSettings } from "@/domain/document/settings";
import { convertDocument } from "@/domain/document/convert";
import { decideOfferInputSchema } from "@/schemas/quote-share";
import { loadMailSettings } from "@/domain/email/settings";
import { createQueuedEmailLog, finishEmailLog } from "@/domain/email/email-log";
import { createSmtpProvider } from "@/lib/mail/smtp";
import type { MailProvider } from "@/lib/mail/provider";

export class AlreadyDecidedError extends Error {
  constructor() {
    super("Zu diesem Angebot liegt bereits eine Entscheidung vor.");
    this.name = "AlreadyDecidedError";
  }
}

export class InvalidShareLinkError extends Error {
  constructor() {
    super("Der Link ist ungueltig, abgelaufen oder widerrufen.");
    this.name = "InvalidShareLinkError";
  }
}

// Rate-Limit je IP UND je Token-Hash (Sicherheitsregel) — verhindert sowohl das
// Durchprobieren vieler Tokens von einer IP als auch wiederholte Angriffe auf EIN Token
// ueber wechselnde IPs.
const DECIDE_RATE_LIMIT = 10;
const DECIDE_RATE_WINDOW_MS = 60_000;

export interface DecideOfferResult {
  quoteId: string;
  decision: "ACCEPTED" | "REJECTED";
  automation?: { type: "QUOTE" | "INVOICE" | "DELIVERY_NOTE"; id: string };
  automationError?: string;
}

export async function decideOffer(
  token: string,
  rawInput: unknown,
  ctx: { ip?: string; now?: Date; provider?: MailProvider } = {},
): Promise<DecideOfferResult> {
  const input = decideOfferInputSchema.parse(rawInput);
  const now = ctx.now ?? new Date();
  const tokenHash = hashToken(token);

  if (ctx.ip) {
    rateLimit(`decide:ip:${ctx.ip}`, { limit: DECIDE_RATE_LIMIT, windowMs: DECIDE_RATE_WINDOW_MS, now: now.getTime() });
  }
  rateLimit(`decide:token:${tokenHash}`, { limit: DECIDE_RATE_LIMIT, windowMs: DECIDE_RATE_WINDOW_MS, now: now.getTime() });

  const resolved = await resolveShareLinkForDecision(token, now);
  if (!resolved) throw new InvalidShareLinkError();
  const { link, quote } = resolved;
  if (link.decidedAt) throw new AlreadyDecidedError();

  const settings = await loadDocumentSettings(quote.orgId);
  const actor = `public:${input.name}`;

  const runDecisionTx = () =>
    dbInternal.$transaction(async (tx) => {
      // Atomar gegen doppelte Entscheidung (z. B. zwei parallele Anfragen mit demselben
      // Token): der Update-Filter greift nur, wenn decidedAt noch null ist.
      const claimed = await tx.quoteShareLink.updateMany({
        where: { id: link.id, decidedAt: null },
        data: {
          decidedAt: now,
          decision: input.decision,
          deciderName: input.name,
          deciderEmail: input.email ?? null,
          deciderComment: input.comment ?? null,
          // IP nur speichern, wenn die Organisation es erlaubt (Sicherheitsregel).
          deciderIp: settings.storeAcceptIp ? (ctx.ip ?? null) : null,
        },
      });
      if (claimed.count === 0) throw new AlreadyDecidedError();

      await setQuoteStatusWithinTx(tx, quote.orgId, quote.id, input.decision, { actor, now, note: input.comment });

      await appendChangeLog(tx, {
        orgId: quote.orgId,
        entity: "QUOTE",
        entityId: quote.id,
        action: input.decision === "ACCEPTED" ? "ACCEPTED_ONLINE" : "REJECTED_ONLINE",
        actor,
        at: now,
        // IP nie im ChangeLog (Sicherheitsregel) — nur Entscheider-Angaben + linkId.
        diff: { name: input.name, email: input.email ?? null, comment: input.comment ?? null, linkId: link.id },
      });
    });

  try {
    await runDecisionTx();
  } catch (e) {
    // G4: ChangeLog.@@unique([orgId, prevHash]) kann bei zwei nahezu gleichzeitigen
    // Entscheidungen verschiedener Angebote derselben Organisation kollidieren (die
    // prevHash-Kette wurde zwischen Lesen und Schreiben von einer anderen Transaktion
    // fortgeschrieben). Die gesamte Transaktion (inkl. des Claims per updateMany) wurde
    // dabei zurueckgerollt, ein einziger Retry mit frisch gelesenem prevHash reicht —
    // der Claim ist idempotent, ein Doppelversuch fuehrt bei bereits entschiedenem Link
    // regulaer zu AlreadyDecidedError statt zu einer zweiten Kollision.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await runDecisionTx();
    } else {
      throw e;
    }
  }

  const result: DecideOfferResult = { quoteId: quote.id, decision: input.decision };

  if (input.decision === "ACCEPTED" && settings.onQuoteAccept !== "NONE") {
    const toKind = settings.onQuoteAccept === "ORDER_CONFIRMATION" ? "AUFTRAGSBESTAETIGUNG" : "INVOICE";
    try {
      result.automation = await convertDocument(quote.orgId, { fromType: "QUOTE", fromId: quote.id, toKind }, { actor, now });
    } catch (e) {
      // Das Angebot bleibt ACCEPTED — der Betreiber sieht den Fehler in der Benachrichtigung.
      result.automationError = e instanceof Error ? e.message : "Unbekannter Fehler bei der Automatik.";
    }
  }

  try {
    await sendInternalNotification(quote.orgId, quote.id, {
      decision: input.decision,
      name: input.name,
      email: input.email,
      comment: input.comment,
      automationError: result.automationError,
      now,
    }, ctx.provider);
  } catch (e) {
    console.warn("decideOffer: interne Benachrichtigung fehlgeschlagen", e);
  }

  return result;
}

export interface SendInternalNotificationInput {
  decision: "ACCEPTED" | "REJECTED";
  name: string;
  email?: string;
  comment?: string;
  automationError?: string;
  now?: Date;
}

/**
 * Benachrichtigt den Betreiber intern ueber eine Online-Entscheidung. Ohne Mail-
 * Einstellungen wird NICHT geworfen (die Entscheidung selbst ist bereits verbucht) —
 * nur `console.warn` und Rueckkehr. Nutzt dieselbe Log-/ChangeLog-Logik wie
 * `sendDocumentEmail` (src/domain/email/email-log.ts), kein Duplikat.
 */
export async function sendInternalNotification(
  orgId: string,
  quoteId: string,
  input: SendInternalNotificationInput,
  provider?: MailProvider,
): Promise<void> {
  const settings = await loadMailSettings(orgId);
  if (!settings) {
    console.warn(`sendInternalNotification: keine Mail-Einstellungen fuer Organisation ${orgId} — Benachrichtigung uebersprungen.`);
    return;
  }

  const org = await dbInternal.organization.findUniqueOrThrow({ where: { id: orgId }, select: { email: true } });
  const to = org.email || settings.fromEmail;

  const quote = await dbInternal.quote.findFirst({ where: { id: quoteId, orgId }, select: { number: true } });
  const docLabel = quote?.number ?? quoteId;

  const decisionLabel = input.decision === "ACCEPTED" ? "angenommen" : "abgelehnt";
  const bodyLines = [
    `Das Angebot ${docLabel} wurde online ${decisionLabel}.`,
    `Name: ${input.name}`,
    `E-Mail: ${input.email ?? "(nicht angegeben)"}`,
    ...(input.comment ? [`Kommentar: ${input.comment}`] : []),
    ...(input.automationError
      ? [`Achtung: die automatische Weiterverarbeitung ist fehlgeschlagen: ${input.automationError}`]
      : []),
  ];
  const text = bodyLines.join("\n");
  const subject = `Angebot ${docLabel} online ${decisionLabel}`;

  const prov = provider ?? createSmtpProvider(settings);

  const log = await createQueuedEmailLog({
    orgId,
    docType: "ANGEBOT",
    docId: quoteId,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo ?? null,
    to: [to],
    cc: [],
    bcc: [],
    subject,
    bodySnapshot: text,
    sentByUserId: "system",
  });

  let status: "SENT" | "FAILED" = "SENT";
  let providerId: string | null = null;
  let error: string | undefined;
  try {
    const res = await prov.send({
      from: { name: settings.fromName, address: settings.fromEmail },
      to: [to],
      cc: [],
      bcc: [],
      replyTo: settings.replyTo ?? undefined,
      subject,
      text,
      attachments: [],
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
    actor: "system",
    docType: "ANGEBOT",
    docId: quoteId,
    docNumber: docLabel,
    to: [to],
    cc: [],
    bcc: [],
    subject,
  });
}
