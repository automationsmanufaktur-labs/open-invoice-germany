"use server";

import { revalidatePath } from "next/cache";
import { getActiveOrg } from "@/lib/org";
import { saveMailSettings, sendTestMail, MailNotConfiguredError } from "@/domain/email/settings";
import { MailSendError } from "@/lib/mail/provider";
import { SecretsUnavailableError } from "@/lib/crypto/secrets";
import { mailSettingsInputSchema } from "@/schemas/email";
import type { ActionResult } from "./result";

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function firstError(issues: { message: string; path: PropertyKey[] }[]): string {
  const i = issues[0];
  return i ? `${i.path.join(".") || "Eingabe"}: ${i.message}` : "Ungültige Eingabe";
}

/** Speichert die Mail-Einstellungen der aktiven Organisation. Leeres Passwort laesst ein
 *  bestehendes Passwort unveraendert (siehe saveMailSettings). */
export async function saveMailSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = mailSettingsInputSchema.safeParse({
    host: str(fd, "host"),
    port: str(fd, "port") ?? "587",
    security: str(fd, "security") ?? "STARTTLS",
    username: str(fd, "username"),
    password: str(fd, "password") ?? "",
    fromName: str(fd, "fromName"),
    fromEmail: str(fd, "fromEmail"),
    replyTo: str(fd, "replyTo") ?? "",
    defaultCc: str(fd, "defaultCc") ?? "",
    defaultBcc: str(fd, "defaultBcc") ?? "",
    copyToSelf: fd.get("copyToSelf") === "on",
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error.issues) };

  try {
    const org = await getActiveOrg();
    await saveMailSettings(org.id, parsed.data);
  } catch (e) {
    if (e instanceof SecretsUnavailableError) return { ok: false, error: e.message };
    console.error("saveMailSettingsAction:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/email");
  return { ok: true };
}

/** Sendet eine Testmail mit den aktuell gespeicherten Einstellungen. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur von useActionState (prev, FormData) verlangt beide Parameter.
export async function sendTestMailAction(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  try {
    const org = await getActiveOrg();
    await sendTestMail(org.id);
  } catch (e) {
    if (e instanceof MailNotConfiguredError) return { ok: false, error: e.message };
    if (e instanceof MailSendError) return { ok: false, error: `Testversand fehlgeschlagen: ${e.message}` };
    console.error("sendTestMailAction:", e);
    return { ok: false, error: "Testversand fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/email");
  return { ok: true };
}
