/**
 * Beleg-Snapshots: Kaeufer- und Verkaeuferdaten zum Zeitpunkt der Festschreibung
 * (Rechnung) bzw. Erstellung (Geschaeftsdokument). Ohne Snapshot wuerde eine
 * spaetere Stammdatenaenderung PDF und XRechnung festgeschriebener Belege
 * rueckwirkend veraendern (GoBD, Lastenheft 29/50).
 *
 * Reine Funktionen — kein DB-Zugriff. Die Objekte entsprechen feldgenau den
 * Eingaben von buildEInvoiceData (src/lib/einvoice/mapper.ts).
 */
import {
  sellerSnapshotSchema,
  buyerSnapshotSchema,
  contactSnapshotSchema,
  type SellerSnapshot,
  type BuyerSnapshot,
  type ContactSnapshot,
} from "@/schemas";

export function buildSellerSnapshot(org: SellerSnapshot): SellerSnapshot {
  return {
    legalName: org.legalName,
    addressLine1: org.addressLine1,
    addressLine2: org.addressLine2,
    postalCode: org.postalCode,
    city: org.city,
    country: org.country,
    vatId: org.vatId,
    taxNumber: org.taxNumber,
    email: org.email,
    phone: org.phone,
    electronicAddress: org.electronicAddress,
    iban: org.iban,
    bic: org.bic,
    bankName: org.bankName,
  };
}

/**
 * `address`/`shippingAddress`/`customFields` werden nur in die Ausgabe uebernommen, wenn
 * der Aufrufer sie mitgibt (`!== undefined`) — sonst bliebe der bestehende exakte Schluesselmengen-Vergleich
 * gegen den Alt-Customer-Fixture (test/unit/snapshot.test.ts) nicht mehr bestehen. Aufrufer
 * ohne Adress-/Custom-Field-Kontext (z. B. Alt-Aufrufe vor Phase 8a) erhalten weiterhin
 * exakt die zehn urspruenglichen Schluessel.
 */
export function buildBuyerSnapshot(customer: BuyerSnapshot): BuyerSnapshot {
  return {
    name: customer.name,
    contactName: customer.contactName,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    postalCode: customer.postalCode,
    city: customer.city,
    countryCode: customer.countryCode,
    vatId: customer.vatId,
    email: customer.email,
    leitwegId: customer.leitwegId,
    ...(customer.address !== undefined ? { address: customer.address } : {}),
    ...(customer.shippingAddress !== undefined ? { shippingAddress: customer.shippingAddress } : {}),
    ...(customer.customFields !== undefined ? { customFields: customer.customFields } : {}),
  };
}

/** Snapshot des am Beleg gewaehlten Ansprechpartners (Phase 8a, §30). Reine Funktion. */
export function buildContactSnapshot(contact: ContactSnapshot): ContactSnapshot {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
  };
}

function tryParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Liefert den Snapshot, wenn vorhanden und gueltig — sonst den Fallback (Live-Relation).
 * Ein defekter Snapshot bricht die Ausgabe nicht, wird aber protokolliert, damit er
 * nicht stumm bleibt.
 */
export function parseSellerSnapshot(json: string | null | undefined, fallback: SellerSnapshot, ctx: string): SellerSnapshot {
  if (!json) return fallback;
  const parsed = sellerSnapshotSchema.safeParse(tryParse(json));
  if (parsed.success) return parsed.data;
  console.warn(`snapshot: Verkaeufer-Snapshot von ${ctx} ungueltig, nutze Live-Daten`);
  return fallback;
}

export function parseBuyerSnapshot(json: string | null | undefined, fallback: BuyerSnapshot, ctx: string): BuyerSnapshot {
  if (!json) return fallback;
  const parsed = buyerSnapshotSchema.safeParse(tryParse(json));
  if (parsed.success) return parsed.data;
  console.warn(`snapshot: Kaeufer-Snapshot von ${ctx} ungueltig, nutze Live-Daten`);
  return fallback;
}

/**
 * Liefert den Ansprechpartner-Snapshot, wenn vorhanden und gueltig — sonst den Fallback
 * (z. B. Legacy-Ableitung aus `contactName`, oder `null`, wenn keiner gewaehlt war).
 */
export function parseContactSnapshot(
  json: string | null | undefined,
  fallback: ContactSnapshot | null,
  ctx: string,
): ContactSnapshot | null {
  if (!json) return fallback;
  const parsed = contactSnapshotSchema.safeParse(tryParse(json));
  if (parsed.success) return parsed.data;
  console.warn(`snapshot: Ansprechpartner-Snapshot von ${ctx} ungueltig, nutze Fallback`);
  return fallback;
}
