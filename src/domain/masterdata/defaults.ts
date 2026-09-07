/**
 * Systemstammdaten, die jede Organisation bekommt — beim Anlegen (ensure*) und per
 * Backfill-Migration fuer Bestandsorganisationen. Die Codes TRANSFER/CASH/CARD/SEPA
 * entsprechen der frueheren Zod-Enum, damit Bestandszahlungen aufloesbar bleiben.
 * untdidCode: UNTDID 4461 (EN 16931 BT-81).
 */
export const SYSTEM_PAYMENT_METHODS = [
  { code: "TRANSFER", name: "Ueberweisung", untdidCode: "58", sortOrder: 1 },
  { code: "CASH", name: "Barzahlung", untdidCode: "10", sortOrder: 2 },
  { code: "CARD", name: "EC-/Debitkarte", untdidCode: "48", sortOrder: 3 },
  { code: "CREDIT_CARD", name: "Kreditkarte", untdidCode: "54", sortOrder: 4 },
  { code: "PAYPAL", name: "PayPal", untdidCode: "68", sortOrder: 5 },
  { code: "SEPA", name: "SEPA-Lastschrift", untdidCode: "59", sortOrder: 6 },
  { code: "PREPAID", name: "Bereits bezahlt", untdidCode: "ZZZ", sortOrder: 7 },
  { code: "OTHER", name: "Sonstige", untdidCode: "ZZZ", sortOrder: 8 },
] as const;

/** Standard-Mahnstufen (Fristen aus dem Lastenheft, Titel wie DUNNING_LEVEL_TITLE). */
export const DEFAULT_DUNNING_STAGES = [
  { order: 0, name: "Zahlungserinnerung", daysAfterDue: 3, newDueDays: 14, feeCents: 0, calculateInterest: false, includeB2BFlatFee: false },
  { order: 1, name: "1. Mahnung", daysAfterDue: 10, newDueDays: 14, feeCents: 0, calculateInterest: true, includeB2BFlatFee: true },
  { order: 2, name: "2. Mahnung", daysAfterDue: 10, newDueDays: 14, feeCents: 0, calculateInterest: true, includeB2BFlatFee: true },
  { order: 3, name: "3. Mahnung", daysAfterDue: 7, newDueDays: 14, feeCents: 0, calculateInterest: true, includeB2BFlatFee: true },
] as const;

/** Standard-E-Mail-Vorlagen (Lastenheft 19). Alle vom Nutzer editierbar; isSystem markiert nur die Herkunft. */
export const DEFAULT_EMAIL_TEMPLATES = [
  { docType: "ANGEBOT", name: "Standard", subject: "Angebot {{document.number}} von {{company.name}}",
    body: "Guten Tag,\n\nanbei erhalten Sie unser Angebot {{document.number}}.\nDas Angebot ist bis zum {{offer.validUntil}} gültig.\n\nFür Rückfragen stehen wir gerne zur Verfügung.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "AUFTRAGSBESTAETIGUNG", name: "Standard", subject: "Auftragsbestätigung {{document.number}}",
    body: "Guten Tag,\n\nvielen Dank für Ihren Auftrag.\nAnbei erhalten Sie die Auftragsbestätigung {{document.number}}.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "PROFORMA", name: "Standard", subject: "Proformarechnung {{document.number}}",
    body: "Guten Tag,\n\nanbei erhalten Sie die Proformarechnung {{document.number}} über {{document.total}}.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "DELIVERY_NOTE", name: "Standard", subject: "Lieferschein {{document.number}}",
    body: "Guten Tag,\n\nanbei erhalten Sie den Lieferschein {{document.number}} zu Ihrer Lieferung.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "INVOICE", name: "Standard", subject: "Rechnung {{document.number}} von {{company.name}}",
    body: "Guten Tag,\n\nanbei erhalten Sie unsere Rechnung {{document.number}} über {{document.total}}.\nDer Rechnungsbetrag ist bis zum {{document.dueDate}} fällig.\n\nVielen Dank.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "CREDIT_NOTE", name: "Standard", subject: "Gutschrift {{document.number}} von {{company.name}}",
    body: "Guten Tag,\n\nanbei erhalten Sie unsere Gutschrift {{document.number}} über {{document.total}}.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "DUNNING", name: "Zahlungserinnerung", dunningOrder: 0, subject: "Zahlungserinnerung zur Rechnung {{invoice.number}}",
    body: "Guten Tag,\n\nsicher ist es Ihrer Aufmerksamkeit entgangen: Unsere Rechnung {{invoice.number}} vom {{invoice.date}} über {{invoice.total}} war am {{invoice.dueDate}} fällig. Offen sind derzeit {{invoice.openAmount}}.\n\nBitte gleichen Sie den Betrag bis zum {{dunning.newDueDate}} aus. Sollte die Zahlung bereits erfolgt sein, betrachten Sie diese Nachricht als gegenstandslos.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "DUNNING", name: "1. Mahnung", dunningOrder: 1, subject: "1. Mahnung zur Rechnung {{invoice.number}}",
    body: "Guten Tag,\n\ntrotz unserer Zahlungserinnerung ist die Rechnung {{invoice.number}} vom {{invoice.date}} noch nicht vollständig beglichen. Offen sind {{invoice.openAmount}}.\n\nBitte zahlen Sie den Betrag von {{dunning.total}} bis zum {{dunning.newDueDate}}.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "DUNNING", name: "2. Mahnung", dunningOrder: 2, subject: "2. Mahnung zur Rechnung {{invoice.number}}",
    body: "Guten Tag,\n\ndie Rechnung {{invoice.number}} vom {{invoice.date}} ist trotz Mahnung weiterhin offen ({{invoice.openAmount}}).\n\nWir bitten um Zahlung von {{dunning.total}} bis spätestens {{dunning.newDueDate}}.\n\nFreundliche Grüße\n{{company.name}}" },
  { docType: "DUNNING", name: "3. Mahnung", dunningOrder: 3, subject: "Letzte Mahnung zur Rechnung {{invoice.number}}",
    body: "Guten Tag,\n\ndies ist unsere letzte Mahnung zur Rechnung {{invoice.number}} vom {{invoice.date}}. Offen sind {{invoice.openAmount}}, zuzüglich Mahnkosten insgesamt {{dunning.total}}.\n\nGeht der Betrag nicht bis zum {{dunning.newDueDate}} ein, behalten wir uns weitere Schritte vor.\n\nFreundliche Grüße\n{{company.name}}" },
] as const;
