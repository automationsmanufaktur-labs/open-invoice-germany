/**
 * Mail-Einstellungen je Organisation (Lastenheft 19/21): Laden/Entschluesseln,
 * Speichern/Verschluesseln, Testmail. Das SMTP-Passwort wird nie im Klartext in der
 * Datenbank abgelegt (src/lib/crypto/secrets.ts) und verlaesst diesen Layer nur ueber
 * `loadMailSettings` (serverseitig, z. B. fuer den SMTP-Versand) — niemals ueber
 * `describeMailSettings` (UI-sicher).
 */
import { dbInternal } from "@/lib/db";
import { encryptSecret, decryptSecret, SecretsUnavailableError } from "@/lib/crypto/secrets";
import { mailSettingsInputSchema, addressListSchema, type MailSettingsInput } from "@/schemas/email";
import type { MailSettings } from "@/generated/prisma/client";
import { createSmtpProvider } from "@/lib/mail/smtp";
import type { MailProvider } from "@/lib/mail/provider";
import { MailSendError } from "@/lib/mail/provider";

export type DecryptedMailSettings = Omit<MailSettings, "passwordEnc"> & { password: string | null };

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Fuer diese Organisation sind keine Mail-Einstellungen hinterlegt.");
    this.name = "MailNotConfiguredError";
  }
}

/** Laedt die Mail-Einstellungen und entschluesselt das Passwort. Bei Entschluesselungsfehlern
 *  (z. B. AUTH_SECRET gewechselt oder nicht gesetzt) wird das Passwort auf `null` gesetzt und
 *  eine Warnung geloggt, statt den Aufrufer hart scheitern zu lassen. */
export async function loadMailSettings(orgId: string): Promise<DecryptedMailSettings | null> {
  const row = await dbInternal.mailSettings.findUnique({ where: { orgId } });
  if (!row) return null;
  const { passwordEnc, ...rest } = row;
  let password: string | null = null;
  if (passwordEnc) {
    try {
      password = decryptSecret(passwordEnc);
    } catch (e) {
      if (e instanceof SecretsUnavailableError) {
        console.warn("Mail-Einstellungen: AUTH_SECRET nicht gesetzt, Passwort nicht verfuegbar.");
      } else {
        console.warn("Mail-Einstellungen: Passwort konnte nicht entschluesselt werden.", e instanceof Error ? e.message : e);
      }
      password = null;
    }
  }
  return { ...rest, password };
}

/** Speichert die Mail-Einstellungen. Ein leeres/fehlendes `password` laesst ein
 *  bestehendes Passwort unveraendert (Neuanlage: `passwordEnc = null`). */
export async function saveMailSettings(orgId: string, rawInput: MailSettingsInput): Promise<DecryptedMailSettings> {
  const input = mailSettingsInputSchema.parse(rawInput);
  const existing = await dbInternal.mailSettings.findUnique({ where: { orgId } });

  let passwordEnc: string | null | undefined;
  if (input.password) {
    passwordEnc = encryptSecret(input.password);
  } else {
    passwordEnc = existing ? existing.passwordEnc : null;
  }

  const defaultCc = addressListSchema.parse(input.defaultCc).join(", ");
  const defaultBcc = addressListSchema.parse(input.defaultBcc).join(", ");

  const data = {
    host: input.host,
    port: input.port,
    security: input.security,
    username: input.username ?? null,
    passwordEnc,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo || null,
    defaultCc,
    defaultBcc,
    copyToSelf: input.copyToSelf,
  };

  await dbInternal.mailSettings.upsert({
    where: { orgId },
    create: { orgId, ...data },
    update: data,
  });

  const settings = await loadMailSettings(orgId);
  if (!settings) throw new Error("Mail-Einstellungen konnten nicht geladen werden.");
  return settings;
}

/** UI-sicheres Abbild der Mail-Einstellungen ohne Passwort/Verschluesselung. */
export async function describeMailSettings(orgId: string): Promise<(Omit<MailSettings, "passwordEnc"> & { hasPassword: boolean }) | null> {
  const row = await dbInternal.mailSettings.findUnique({ where: { orgId } });
  if (!row) return null;
  const { passwordEnc, ...rest } = row;
  return { ...rest, hasPassword: Boolean(passwordEnc) };
}

/** Sendet eine Testmail an die uebergebene Organisation (Empfaenger: `org.email`, Fallback
 *  `fromEmail`) und schreibt Erfolg/Fehler in `lastTestAt`/`lastTestOk`. Kein `EmailLog`. */
export async function sendTestMail(orgId: string, provider?: MailProvider): Promise<{ ok: true }> {
  const settings = await loadMailSettings(orgId);
  if (!settings) throw new MailNotConfiguredError();
  const org = await dbInternal.organization.findUniqueOrThrow({ where: { id: orgId }, select: { email: true } });
  const to = org.email || settings.fromEmail;
  const prov = provider ?? createSmtpProvider(settings);
  const now = new Date();

  try {
    await prov.send({
      from: { name: settings.fromName, address: settings.fromEmail },
      to: [to],
      cc: [],
      bcc: [],
      replyTo: settings.replyTo ?? undefined,
      subject: "Testnachricht von OpenInvoice",
      text: `Dies ist eine Testnachricht der Mail-Einstellungen von OpenInvoice.\n\nHost: ${settings.host}\nPort: ${settings.port}\nGesendet am: ${now.toISOString()}`,
      attachments: [],
    });
    await dbInternal.mailSettings.update({ where: { orgId }, data: { lastTestAt: now, lastTestOk: true } });
    return { ok: true };
  } catch (e) {
    await dbInternal.mailSettings.update({ where: { orgId }, data: { lastTestAt: now, lastTestOk: false } });
    if (e instanceof MailSendError) throw e;
    throw new MailSendError(e instanceof Error ? e.message : "Unbekannter Fehler beim Testversand");
  }
}
