"use server";

import { revalidatePath } from "next/cache";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { emailTemplateInputSchema } from "@/schemas/email";
import {
  saveEmailTemplate,
  deleteEmailTemplate,
  TemplateNotFoundError,
  SystemTemplateProtectedError,
  TemplateNameConflictError,
} from "@/domain/email/templates";
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

/** Legt eine Vorlage an oder aktualisiert sie. Wird `isDefault` gesetzt, werden alle
 *  anderen Vorlagen desselben Dokumenttyps in derselben Transaktion auf `false` gesetzt. */
export async function saveEmailTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = emailTemplateInputSchema.safeParse({
    id: str(fd, "id"),
    name: str(fd, "name"),
    docType: str(fd, "docType"),
    subject: str(fd, "subject"),
    body: str(fd, "body"),
    signature: str(fd, "signature"),
    isDefault: fd.get("isDefault") === "on",
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error.issues) };

  try {
    const org = await getActiveOrg();
    await saveEmailTemplate(org.id, parsed.data);
  } catch (e) {
    // G6: eine verstaendliche Meldung bei doppeltem Namen/docType; alle anderen Fehler
    // nur generisch — e.message wird nicht mehr durchgereicht.
    if (e instanceof TemplateNameConflictError) return { ok: false, error: e.message };
    console.error("saveEmailTemplateAction:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/vorlagen");
  return { ok: true };
}

/** Loescht eine Vorlage. Eine Systemvorlage darf nur geloescht werden, wenn fuer denselben
 *  Dokumenttyp eine ANDERE Vorlage bereits als Standard markiert ist. War die geloeschte
 *  Vorlage Standard, wird in derselben Transaktion eine verbleibende Vorlage desselben
 *  Dokumenttyps zum neuen Standard (bevorzugt Systemvorlage, sonst aelteste) (W1). */
export async function deleteEmailTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "Vorlage nicht gefunden." };

  try {
    const org = await getActiveOrg();
    await deleteEmailTemplate(org.id, id);
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return { ok: false, error: "Vorlage nicht gefunden." };
    if (e instanceof SystemTemplateProtectedError) return { ok: false, error: e.message };
    console.error("deleteEmailTemplateAction:", e);
    return { ok: false, error: "Löschen fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/vorlagen");
  return { ok: true };
}

/** Setzt eine Vorlage als Standard fuer ihren Dokumenttyp; alle anderen Vorlagen desselben
 *  Typs werden in derselben Transaktion auf `isDefault = false` gesetzt. */
export async function setDefaultEmailTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "Vorlage nicht gefunden." };

  try {
    const org = await getActiveOrg();
    const tpl = await dbInternal.emailTemplate.findFirst({ where: { id, orgId: org.id } });
    if (!tpl) return { ok: false, error: "Vorlage nicht gefunden." };

    await dbInternal.$transaction(async (tx) => {
      await tx.emailTemplate.updateMany({ where: { orgId: org.id, docType: tpl.docType }, data: { isDefault: false } });
      await tx.emailTemplate.update({ where: { id: tpl.id }, data: { isDefault: true } });
    });
  } catch (e) {
    console.error("setDefaultEmailTemplateAction:", e);
    return { ok: false, error: "Aktion fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/vorlagen");
  return { ok: true };
}
