/**
 * Offener Betrag einer Rechnung (brutto). Phase 5 (§13-15 UStG): eine Schlussrechnung
 * traegt in `payableCents` den um die Abschlaege bereits reduzierten Restbetrag
 * (`grossTotalCents - prepaidCents`) — Zahlungen, PAID-Grenze und Skonto-Basis muessen
 * sich darauf beziehen, nicht auf `grossTotalCents` (sonst waere der Abschlag doppelt
 * gefordert). Bei allen anderen Rechnungstypen ist `payableCents` NULL und der offene
 * Betrag bezieht sich unveraendert auf `grossTotalCents` (COALESCE-Semantik, siehe
 * Prisma-Schema-Kommentar auf `Invoice.payableCents`).
 */
export interface OpenAmountInvoice {
  grossTotalCents: number;
  paidAmountCents: number;
  payableCents: number | null;
}

/** Bemessungsgrundlage fuer Zahlungen/PAID-Grenze/Skonto: `payableCents ?? grossTotalCents`. */
export function payableBaseCents(invoice: Pick<OpenAmountInvoice, "grossTotalCents" | "payableCents">): number {
  return invoice.payableCents ?? invoice.grossTotalCents;
}

/** Offener Rest (brutto) = Bemessungsgrundlage minus bereits erfasste Zahlungen. */
export function openAmountCents(invoice: OpenAmountInvoice): number {
  return payableBaseCents(invoice) - invoice.paidAmountCents;
}
