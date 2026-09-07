"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import {
  savePaymentMethod,
  deletePaymentMethod,
  PaymentMethodNotFoundError,
  SystemPaymentMethodProtectedError,
  PaymentMethodCodeConflictError,
  PaymentMethodInUseError,
} from "@/domain/payment-method/manage";
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

/** Legt eine Zahlungsmethode an oder aktualisiert sie (id gesetzt = Update). */
export async function savePaymentMethodAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id") ?? null;
  const raw = {
    code: str(fd, "code"),
    name: str(fd, "name"),
    description: str(fd, "description"),
    paymentTermsDays: str(fd, "paymentTermsDays") ? Number(str(fd, "paymentTermsDays")) : undefined,
    invoiceText: str(fd, "invoiceText"),
    bankAccountRef: str(fd, "bankAccountRef"),
    bankIban: str(fd, "bankIban"),
    bankBic: str(fd, "bankBic"),
    bankName: str(fd, "bankName"),
    untdidCode: str(fd, "untdidCode") ?? "ZZZ",
    isActive: fd.get("isActive") === "on",
    sortOrder: str(fd, "sortOrder") ? Number(str(fd, "sortOrder")) : 0,
  };

  try {
    const org = await getActiveOrg();
    await savePaymentMethod(org.id, id, raw);
  } catch (e) {
    if (e instanceof PaymentMethodNotFoundError) return { ok: false, error: "Zahlungsmethode nicht gefunden." };
    if (e instanceof SystemPaymentMethodProtectedError) return { ok: false, error: e.message };
    if (e instanceof PaymentMethodCodeConflictError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: firstError(e.issues) };
    console.error("savePaymentMethodAction:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/zahlungsmethoden");
  redirect("/einstellungen/zahlungsmethoden?saved=1");
}

/** Loescht eine (nicht-System-)Zahlungsmethode, sofern sie nicht mehr referenziert wird. */
export async function deletePaymentMethodAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "Zahlungsmethode nicht gefunden." };

  try {
    const org = await getActiveOrg();
    await deletePaymentMethod(org.id, id);
  } catch (e) {
    if (e instanceof PaymentMethodNotFoundError) return { ok: false, error: "Zahlungsmethode nicht gefunden." };
    if (e instanceof SystemPaymentMethodProtectedError) return { ok: false, error: e.message };
    if (e instanceof PaymentMethodInUseError) return { ok: false, error: e.message };
    console.error("deletePaymentMethodAction:", e);
    return { ok: false, error: "Löschen fehlgeschlagen." };
  }
  revalidatePath("/einstellungen/zahlungsmethoden");
  return { ok: true };
}
