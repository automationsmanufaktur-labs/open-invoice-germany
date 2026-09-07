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

/** Speichert die Beleg-Einstellungen der aktiven Organisation (Einstellungen → Belege, §33). */
export async function saveDocumentSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const raw = {
    onQuoteAccept: fd.get("onQuoteAccept") ?? "NONE",
    shareLinkDays: fd.get("shareLinkDays") ?? "30",
    storeAcceptIp: fd.get("storeAcceptIp") === "on",
    autoFinalizeOnSend: fd.get("autoFinalizeOnSend") === "on",
    defaultCurrency: fd.get("defaultCurrency") || "EUR",
    quoteValidityDays: fd.get("quoteValidityDays") ?? "30",
    shareLinkDefaultOn: fd.get("shareLinkDefaultOn") === "on",
    dnShowPrices: fd.get("dnShowPrices") === "on",
    dnShowArticleNumber: fd.get("dnShowArticleNumber") === "on",
    dnShowDeliveryAddress: fd.get("dnShowDeliveryAddress") === "on",
    invoiceDueDays: fd.get("invoiceDueDays") ?? "14",
    showPaymentTermsText: fd.get("showPaymentTermsText") === "on",
    autoDeliveryDate: fd.get("autoDeliveryDate") === "on",
    refreshIssueDateOnFinalize: fd.get("refreshIssueDateOnFinalize") === "on",
    offerLastDocument: fd.get("offerLastDocument") === "on",
    eInvoiceDefault: fd.get("eInvoiceDefault") === "on",
    defaultPaymentMethodId: fd.get("defaultPaymentMethodId") || null,
    recurringInsertPeriodText: fd.get("recurringInsertPeriodText") === "on",
    recurringAutoFinalizeDefault: fd.get("recurringAutoFinalizeDefault") === "on",
    recurringAutoSendDefault: fd.get("recurringAutoSendDefault") === "on",
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
  revalidatePath("/einstellungen/belege");
  return { ok: true };
}
