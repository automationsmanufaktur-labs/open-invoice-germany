/**
 * Org-weite Einstellungen fuer Angebotsannahme und Dokumentverhalten (Phase 3b, Task 2):
 * Automatik nach Online-Annahme (`onQuoteAccept`), Standard-Gueltigkeitsdauer neuer
 * Angebotslinks (`shareLinkDays`), ob die IP-Adresse des Entscheiders gespeichert wird
 * (`storeAcceptIp`). Ohne gespeicherte Zeile gelten die Defaults — keine Migration noetig,
 * bevor eine Organisation die Einstellungen zum ersten Mal oeffnet.
 */
import { dbInternal } from "@/lib/db";
import { documentSettingsInputSchema, type DocumentSettingsInput } from "@/schemas/quote-share";

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettingsInput = documentSettingsInputSchema.parse({});

/** Laedt die Dokument-Einstellungen einer Organisation; Defaults, wenn noch keine Zeile existiert. */
export async function loadDocumentSettings(orgId: string): Promise<DocumentSettingsInput> {
  const row = await dbInternal.documentSettings.findUnique({ where: { orgId } });
  if (!row) return DEFAULT_DOCUMENT_SETTINGS;
  return documentSettingsInputSchema.parse({
    onQuoteAccept: row.onQuoteAccept,
    shareLinkDays: row.shareLinkDays,
    storeAcceptIp: row.storeAcceptIp,
    autoFinalizeOnSend: row.autoFinalizeOnSend,
    defaultCurrency: row.defaultCurrency,
    quoteValidityDays: row.quoteValidityDays,
    shareLinkDefaultOn: row.shareLinkDefaultOn,
    dnShowPrices: row.dnShowPrices,
    dnShowArticleNumber: row.dnShowArticleNumber,
    dnShowDeliveryAddress: row.dnShowDeliveryAddress,
    invoiceDueDays: row.invoiceDueDays,
    showPaymentTermsText: row.showPaymentTermsText,
    autoDeliveryDate: row.autoDeliveryDate,
    refreshIssueDateOnFinalize: row.refreshIssueDateOnFinalize,
    offerLastDocument: row.offerLastDocument,
    eInvoiceDefault: row.eInvoiceDefault,
    defaultPaymentMethodId: row.defaultPaymentMethodId,
    recurringInsertPeriodText: row.recurringInsertPeriodText,
    recurringAutoFinalizeDefault: row.recurringAutoFinalizeDefault,
    recurringAutoSendDefault: row.recurringAutoSendDefault,
  });
}

/** Speichert die Dokument-Einstellungen (Upsert, da anfangs keine Zeile existiert). */
export async function saveDocumentSettings(orgId: string, rawInput: unknown): Promise<DocumentSettingsInput> {
  const input = documentSettingsInputSchema.parse(rawInput);
  await dbInternal.documentSettings.upsert({
    where: { orgId },
    create: { orgId, ...input },
    update: { ...input },
  });
  return input;
}
