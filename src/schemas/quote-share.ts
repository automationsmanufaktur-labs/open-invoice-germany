/**
 * Zod-Schemas fuer Angebotslinks, Online-Entscheidung und die zugehoerigen
 * Dokument-Einstellungen (Phase 3b, Task 2). Domain-Funktionen parsen ihre
 * Eingabe selbst (Lastenheft 50/55) — kein Bypass ueber Route oder MCP.
 */
import { z } from "zod";

/** Automatik nach Online-Annahme eines Angebots. */
export const OnQuoteAccept = z.enum(["NONE", "ORDER_CONFIRMATION", "INVOICE"]);
export type OnQuoteAccept = z.infer<typeof OnQuoteAccept>;

// Phase 7, Task 1: 3-stelliger Grossbuchstaben-Waehrungscode (ISO 4217, keine Validierung
// gegen eine Codeliste — genuegt fuer §33-Zwecke).
const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Waehrung muss aus drei Grossbuchstaben bestehen (ISO 4217)");

export const documentSettingsInputSchema = z.object({
  onQuoteAccept: OnQuoteAccept.default("NONE"),
  /** Gueltigkeitsdauer neu erzeugter Angebotslinks in Tagen (Default, ueberschreibbar je Link). */
  shareLinkDays: z.coerce.number().int().min(1).max(365).default(30),
  /** Ob die IP-Adresse des Entscheiders beim Annehmen/Ablehnen gespeichert wird. */
  storeAcceptIp: z.boolean().default(false),
  // Phase 7, Task 1 (§33) — weitere org-weite Dokument-Defaults.
  /** Ob eine Rechnung nach dem Versand automatisch festgeschrieben wird. */
  autoFinalizeOnSend: z.boolean().default(false),
  /** Default-Waehrung neuer Belege. */
  defaultCurrency: currencyCode.default("EUR"),
  /** Default-Gueltigkeitsdauer neuer Angebote in Tagen. */
  quoteValidityDays: z.coerce.number().int().min(0).max(365).default(30),
  /** Ob neu erzeugte Angebote standardmaessig einen Freigabelink erhalten. */
  shareLinkDefaultOn: z.boolean().default(true),
  /** Ob Lieferscheine standardmaessig Preise zeigen. */
  dnShowPrices: z.boolean().default(false),
  /** Ob Lieferscheine standardmaessig Artikelnummern zeigen. */
  dnShowArticleNumber: z.boolean().default(true),
  /** Ob Lieferscheine standardmaessig die Lieferadresse zeigen. */
  dnShowDeliveryAddress: z.boolean().default(true),
  /** Default-Zahlungsziel neuer Rechnungen in Tagen. */
  invoiceDueDays: z.coerce.number().int().min(0).max(365).default(14),
  /** Ob der Zahlungsbedingungs-Freitext standardmaessig auf dem Beleg erscheint. */
  showPaymentTermsText: z.boolean().default(true),
  /** Ob das Lieferdatum bei Festschreibung automatisch aufgefrischt wird. */
  autoDeliveryDate: z.boolean().default(true),
  /** Ob das Rechnungsdatum bei Festschreibung automatisch auf "heute" gesetzt wird. */
  refreshIssueDateOnFinalize: z.boolean().default(true),
  /** Ob beim Anlegen der zuletzt verwendete Beleg als Vorlage angeboten wird. */
  offerLastDocument: z.boolean().default(true),
  /** Ob neue Rechnungen standardmaessig als E-Rechnung markiert werden. */
  eInvoiceDefault: z.boolean().default(true),
  /** Default-Zahlungsmethode neuer Belege (PaymentMethod.id), NULL = keine Vorauswahl. */
  defaultPaymentMethodId: z.string().nullable().default(null),
  /** Ob der Leistungszeitraum-Text bei Dauerrechnungen automatisch eingefuegt wird. */
  recurringInsertPeriodText: z.boolean().default(true),
  /** Default fuer RecurringInvoice.autoFinalize bei neuen Dauerauftraegen. */
  recurringAutoFinalizeDefault: z.boolean().default(false),
  /** Default fuer RecurringInvoice.autoSend bei neuen Dauerauftraegen. */
  recurringAutoSendDefault: z.boolean().default(false),
});
export type DocumentSettingsInput = z.infer<typeof documentSettingsInputSchema>;

export const createShareLinkInputSchema = z.object({
  /** Ueberschreibt DocumentSettings.shareLinkDays fuer diesen einen Link. */
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;

// W1: E-Mail ist optional — ein leerer String (aus dem Formular, wo das Feld nicht
// `required` ist) wird VOR der Validierung zu `undefined`, damit er nicht als
// "ungueltige E-Mail-Adresse" abgelehnt wird. Ein tatsaechlich angegebener Wert muss
// weiterhin eine gueltige Adresse sein.
const deciderEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().pipe(z.email("Ungueltige E-Mail-Adresse")).optional(),
);

export const decideOfferInputSchema = z.object({
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  name: z.string().trim().min(1, "Name fehlt").max(200),
  email: deciderEmail,
  comment: z.string().trim().max(2000).optional(),
});
export type DecideOfferInput = z.infer<typeof decideOfferInputSchema>;
