/**
 * Positionsnetto mit Prozent- und/oder Festbetragsrabatt.
 *
 * Rechenbeispiel: 2,5 Std. (quantityMilli = 2500) à 100,00 € (unitNetPriceCents
 * = 10000), 10 % Rabatt (discountPermille = 100) und zusätzlich 5,00 €
 * Festrabatt (discountCents = 500):
 *   grossLineCents   = round(2500 * 10000 / 1000)              = 25000  (250,00 €)
 *   prozentualerAbzug = round(25000 * 100 / 1000)               =  2500  (25,00 €)
 *   lineNetCents      = max(0, 25000 - 2500 - 500)              = 22000  (220,00 €)
 *   discountTotalCents = 25000 - 22000                          =  3000  (30,00 €)
 */
import { roundHalfUp } from "../money";
import { PricingError } from "./errors";

export interface LineInput {
  quantityMilli: number;
  unitNetPriceCents: number;
  /** Prozentualer Positionsrabatt in Promille (0..1000 = 0..100 %). */
  discountPermille?: number;
  /** Zusätzlicher Festbetragsrabatt in Cent (wird nach dem Prozentrabatt abgezogen). */
  discountCents?: number;
}

export interface LineNetResult {
  /** Menge * Einzelpreis vor jedem Rabatt. */
  grossLineCents: number;
  /** Summe aus Prozent- und Festbetragsrabatt (begrenzt auf grossLineCents). */
  discountTotalCents: number;
  /** Netto nach Abzug aller Rabatte, nie negativ. */
  lineNetCents: number;
}

export function computeLineNet(l: LineInput): LineNetResult {
  const discountPermille = l.discountPermille ?? 0;
  const discountCents = l.discountCents ?? 0;

  if (l.quantityMilli < 0) {
    throw new PricingError(`quantityMilli darf nicht negativ sein: ${l.quantityMilli}`);
  }
  if (l.unitNetPriceCents < 0) {
    throw new PricingError(`unitNetPriceCents darf nicht negativ sein: ${l.unitNetPriceCents}`);
  }
  if (discountPermille < 0 || discountPermille > 1000) {
    throw new PricingError(`discountPermille muss zwischen 0 und 1000 liegen: ${discountPermille}`);
  }
  if (discountCents < 0) {
    throw new PricingError(`discountCents darf nicht negativ sein: ${discountCents}`);
  }

  const grossLineCents = roundHalfUp((l.quantityMilli * l.unitNetPriceCents) / 1000);
  const percentDiscountCents = roundHalfUp((grossLineCents * discountPermille) / 1000);
  const lineNetCents = Math.max(0, grossLineCents - percentDiscountCents - discountCents);
  const discountTotalCents = grossLineCents - lineNetCents;

  return { grossLineCents, discountTotalCents, lineNetCents };
}
