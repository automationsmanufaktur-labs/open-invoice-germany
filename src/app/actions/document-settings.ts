"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { saveDocumentSettings } from "@/domain/document/settings";
import type { ActionResult } from "./result";

function firstError(issues: { message: string; path: PropertyKey[] }[]): string {
  const i = issues[0];
  return i ? `${i.path.join(".") || "Eingabe"}: ${i.message}` : "Ungültige Eingabe";
}

/** Speichert die Dokument-Einstellungen der aktiven Organisation (Einstellungen → Dokumente). */
export async function saveDocumentSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const raw = {
    onQuoteAccept: fd.get("onQuoteAccept") ?? "NONE",
    shareLinkDays: fd.get("shareLinkDays") ?? "30",
    storeAcceptIp: fd.get("storeAcceptIp") === "on",
  };

  try {
    const org = await getActiveOrg();
    await saveDocumentSettings(org.id, raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: firstError(e.issues) };
    }
    console.error("saveDocumentSettingsAction:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/dokumente");
  return { ok: true };
}
