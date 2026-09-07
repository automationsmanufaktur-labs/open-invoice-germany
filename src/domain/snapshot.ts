/**
 * Beleg-Snapshots: Kaeufer- und Verkaeuferdaten zum Zeitpunkt der Festschreibung
 * (Rechnung) bzw. Erstellung (Geschaeftsdokument). Ohne Snapshot wuerde eine
 * spaetere Stammdatenaenderung PDF und XRechnung festgeschriebener Belege
 * rueckwirkend veraendern (GoBD, Lastenheft 29/50).
 *
 * Reine Funktionen — kein DB-Zugriff. Die Objekte entsprechen feldgenau den
 * Eingaben von buildEInvoiceData (src/lib/einvoice/mapper.ts).
 */
import { sellerSnapshotSchema, buyerSnapshotSchema, type SellerSnapshot, type BuyerSnapshot } from "@/schemas";

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
