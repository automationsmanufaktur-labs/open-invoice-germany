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
