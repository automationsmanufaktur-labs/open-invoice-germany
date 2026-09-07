/**
 * Loest den Kaeufer-Snapshot fuer ein Geschaeftsdokument unter Beruecksichtigung von
 * Ansprechpartner/Rechnungsadresse auf (Task-2-Review-Auflage): Ist eine ContactPerson
 * bzw. CustomerAddress am Beleg gesetzt, ueberschreibt sie Name/Adresse im Snapshot —
 * sonst gelten die Kundendaten (Fallback). Von createBusinessDocument (CREATE) UND
 * setQuoteStatus (SENT) genutzt, damit beide denselben Snapshot bauen.
 *
 * Phase 8a (§29/§31): traegt zusaetzlich `address` (die strukturierte, tatsaechlich
 * gewaehlte CustomerAddress-Zeile — nur gesetzt, wenn `billingAddressId` eine Adresse
 * trifft) und `customFields` (Snapshot der Kunden-Zusatzfelder zum Zeitpunkt der Anlage)
 * in den Buyer-Snapshot ein.
 */
import type { Prisma } from "@/generated/prisma/client";
import { buildBuyerSnapshot } from "@/domain/snapshot";
import { parseCustomerCustomFields } from "@/domain/customer/custom-fields";
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
  customFieldsJson?: string | null;
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
  let address: BuyerSnapshot["address"] | undefined;

  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId } });
    if (contact) contactName = `${contact.firstName} ${contact.lastName}`.trim();
  }
  if (billingAddressId) {
    const found = await tx.customerAddress.findFirst({ where: { id: billingAddressId, orgId } });
    if (found) {
      addressLine1 = found.addressLine1;
      addressLine2 = found.addressLine2;
      postalCode = found.postalCode;
      city = found.city;
      countryCode = found.countryCode;
      address = {
        type: found.type as "BILLING" | "SHIPPING" | "OTHER",
        label: found.label,
        addressLine1: found.addressLine1,
        addressLine2: found.addressLine2,
        postalCode: found.postalCode,
        city: found.city,
        countryCode: found.countryCode,
      };
    }
  }

  const customFields =
    customer.customFieldsJson !== undefined ? await parseCustomerCustomFields(orgId, customer.customFieldsJson ?? null) : undefined;

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
    ...(address !== undefined ? { address } : {}),
    ...(customFields !== undefined ? { customFields } : {}),
  });
}
