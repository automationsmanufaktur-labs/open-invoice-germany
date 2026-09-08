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

/** M5 (Fix-Welle 12c): Unterscheidet "Feld fehlt" (legitim — z. B. ein Formular ohne
 *  `TaxRatesField`) von "Feld ist da, aber kaputt" (Hidden-Input liefert theoretisch
 *  IMMER gueltiges JSON, aber ein manipulierter/fehlerhafter Request-Body soll die
 *  GoBD-relevante Steuersatz-Liste NICHT still auf [19,7,0] zuruecksetzen).
 *  BEWUSST NICHT exportiert: diese Datei traegt "use server" — Next.js/Turbopack
 *  erlaubt dort AUSSCHLIESSLICH async-Funktions-Exporte (jeder andere Export, auch ein
 *  Symbol/eine Konstante, bricht mit "A 'use server' file can only export async
 *  functions" zur Laufzeit — im Dev-Server sofort sichtbar, `next build` hat das NICHT
 *  vorab abgefangen). Wird ausschliesslich innerhalb dieser Datei verwendet. */
const TAX_RATES_PARSE_ERROR = Symbol("taxRatesParseError");

/** Liest das versteckte `taxRates`-Feld (`TaxRatesField`, JSON-Array).
 *  - Feld fehlt (`raw` kein String, z. B. `null`) -> `undefined`, der Zod-Default greift
 *    (`taxRatesSchema.default([19, 7, 0])`) — unveraendert legitim.
 *  - Feld ist ein String, aber kein gueltiges JSON-Array -> `TAX_RATES_PARSE_ERROR`; der
 *    Aufrufer bricht damit explizit ab, statt die Liste still zurueckzusetzen.
 *  - Gueltiges JSON-Array (auch mit ungueltigen Werten) laeuft unveraendert in
 *    `saveDocumentSettings`, dessen `taxRatesSchema` es mit lesbarem Pfad ablehnt. */
function parseTaxRatesField(raw: FormDataEntryValue | null): number[] | undefined | typeof TAX_RATES_PARSE_ERROR {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : TAX_RATES_PARSE_ERROR;
  } catch {
    return TAX_RATES_PARSE_ERROR;
  }
}

/** Speichert die Beleg-Einstellungen der aktiven Organisation (Einstellungen → Belege, §33). */
export async function saveDocumentSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const taxRates = parseTaxRatesField(fd.get("taxRates"));
  if (taxRates === TAX_RATES_PARSE_ERROR) {
    return { ok: false, error: "Steuersätze konnten nicht gelesen werden." };
  }
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
    taxRates,
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
