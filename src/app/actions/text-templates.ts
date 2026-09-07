"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import {
  saveTextTemplate,
  deleteTextTemplate,
  setDefaultTextTemplate,
  TemplateNotFoundError,
  SystemTemplateProtectedError,
  TemplateNameConflictError,
} from "@/domain/text-template/manage";
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

/** Legt eine Dokumenttextvorlage an oder aktualisiert sie. */
export async function saveTextTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const input = {
    id: str(fd, "id"),
    name: str(fd, "name"),
    docType: str(fd, "docType"),
    position: str(fd, "position"),
    body: str(fd, "body"),
    isDefault: fd.get("isDefault") === "on",
  };

  try {
    const org = await getActiveOrg();
    await saveTextTemplate(org.id, input);
  } catch (e) {
    if (e instanceof TemplateNameConflictError) return { ok: false, error: e.message };
    if (e instanceof TemplateNotFoundError) return { ok: false, error: "Vorlage nicht gefunden." };
    if (e instanceof z.ZodError) return { ok: false, error: firstError(e.issues) };
    console.error("saveTextTemplateAction:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/textvorlagen");
  return { ok: true };
}

/** Loescht eine Dokumenttextvorlage. */
export async function deleteTextTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "Vorlage nicht gefunden." };

  try {
    const org = await getActiveOrg();
    await deleteTextTemplate(org.id, id);
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return { ok: false, error: "Vorlage nicht gefunden." };
    if (e instanceof SystemTemplateProtectedError) return { ok: false, error: e.message };
    console.error("deleteTextTemplateAction:", e);
    return { ok: false, error: "Löschen fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/textvorlagen");
  return { ok: true };
}

/** Setzt eine Dokumenttextvorlage als Standard fuer ihre (docType, position)-Kombination. */
export async function setDefaultTextTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "Vorlage nicht gefunden." };

  try {
    const org = await getActiveOrg();
    await setDefaultTextTemplate(org.id, id);
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return { ok: false, error: "Vorlage nicht gefunden." };
    console.error("setDefaultTextTemplateAction:", e);
    return { ok: false, error: "Aktion fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/textvorlagen");
  return { ok: true };
}
