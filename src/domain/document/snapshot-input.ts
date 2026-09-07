/**
 * Loest den Kaeufer-Snapshot fuer ein Geschaeftsdokument unter Beruecksichtigung von
 * Ansprechpartner/Rechnungsadresse auf (Task-2-Review-Auflage): Ist eine ContactPerson
 * bzw. CustomerAddress am Beleg gesetzt, ueberschreibt sie Name/Adresse im Snapshot —
 * sonst gelten die Kundendaten (Fallback). Von createBusinessDocument (CREATE) UND
 * setQuoteStatus (SENT) genutzt, damit beide denselben Snapshot bauen.
 */
import type { Prisma } from "@/generated/prisma/client";
import { buildBuyerSnapshot } from "@/domain/snapshot";
import type { BuyerSnapshot } from "@/schemas";

interface CustomerLike {
  name: string;
  contactName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  vatId: string | null;
  email: string | null;
  leitwegId: string | null;
}

export async function resolveBuyerSnapshot(
  tx: Prisma.TransactionClient,
  orgId: string,
  customer: CustomerLike,
  contactPersonId: string | null | undefined,
  billingAddressId: string | null | undefined,
): Promise<BuyerSnapshot> {
  let contactName = customer.contactName;
  let addressLine1 = customer.addressLine1;
  let addressLine2 = customer.addressLine2;
  let postalCode = customer.postalCode;
  let city = customer.city;
  let countryCode = customer.countryCode;

  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId } });
    if (contact) contactName = `${contact.firstName} ${contact.lastName}`.trim();
  }
  if (billingAddressId) {
    const address = await tx.customerAddress.findFirst({ where: { id: billingAddressId, orgId } });
    if (address) {
      addressLine1 = address.addressLine1;
      addressLine2 = address.addressLine2;
      postalCode = address.postalCode;
      city = address.city;
      countryCode = address.countryCode;
    }
  }

  return buildBuyerSnapshot({
    name: customer.name,
    contactName,
    addressLine1,
    addressLine2,
    postalCode,
    city,
    countryCode,
    vatId: customer.vatId,
    email: customer.email,
    leitwegId: customer.leitwegId,
  });
}
