// src/app/dokumente/[id]/_parts/DocumentStatusCard.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusCard, type StatusRow } from "@/components/detail/StatusCard";
import { formatCents } from "@/lib/money";
import { parseBuyerSnapshot, parseContactSnapshot } from "@/domain/snapshot";
import type { BuyerSnapshot } from "@/schemas";

function deDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

interface QuoteForStatusCard {
  id: string;
  subject: string | null;
  customerReference: string | null;
  issueDate: Date;
  validUntil: Date | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  netTotalCents: number;
  taxTotalCents: number;
  grossTotalCents: number;
  currency: string;
  buyerSnapshotJson: string | null;
  contactSnapshotJson: string | null;
  customer: {
    id: string;
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
  };
  contactPerson: { firstName: string; lastName: string; role: string | null; email: string | null; phone: string | null } | null;
  billingAddress: { addressLine1: string; addressLine2: string | null; postalCode: string; city: string; countryCode: string } | null;
}

/**
 * Statuskarte der Dokumentdetailseite (Phase 11d, Task 4, `aside`-Slot) — buendelt die
 * frueheren "Empfänger"/"Eckdaten"-Karten als kompakte Zeilen. Rechnungsadresse UND
 * Ansprechpartner kommen aus dem jeweiligen Beleg-Snapshot (Lastenheft 29/50: spaetere
 * Stammdaten-Aenderungen duerfen alte Belege nicht ruecktwirkend veraendern) mit Fallback
 * auf die am Beleg gewaehlte/lebende Adresse bzw. den lebenden Kontakt fuer Alt-Belege ohne
 * Snapshot (z. B. MIGRATION-Bestand vor Phase 0).
 *
 * Fallback-Abweichung zum PDF: ohne Snapshot faellt diese Karte auf `billingAddress`/
 * `contactPerson` zurueck, das PDF (`src/domain/document/pdf-data.ts`) dagegen auf
 * `customer`/keinen Kontakt — beide Faelle betreffen nur Alt-Belege ohne Snapshot.
 */
export function DocumentStatusCard({
  q,
  status,
  children,
}: {
  q: QuoteForStatusCard;
  /** Wirksamer Status (aus `effectiveQuoteStatus`, page.tsx) fuer das StatusBadge. */
  status: string;
  children?: ReactNode;
}) {
  const buyerFallback: BuyerSnapshot = {
    name: q.customer.name,
    contactName: q.customer.contactName,
    addressLine1: q.billingAddress?.addressLine1 ?? q.customer.addressLine1,
    addressLine2: q.billingAddress?.addressLine2 ?? q.customer.addressLine2,
    postalCode: q.billingAddress?.postalCode ?? q.customer.postalCode,
    city: q.billingAddress?.city ?? q.customer.city,
    countryCode: q.billingAddress?.countryCode ?? q.customer.countryCode,
    vatId: q.customer.vatId,
    email: q.customer.email,
    leitwegId: q.customer.leitwegId,
  };
  const buyer = parseBuyerSnapshot(q.buyerSnapshotJson, buyerFallback, q.id);
  const contact = parseContactSnapshot(
    q.contactSnapshotJson,
    q.contactPerson
      ? {
          firstName: q.contactPerson.firstName,
          lastName: q.contactPerson.lastName,
          role: q.contactPerson.role,
          email: q.contactPerson.email,
          phone: q.contactPerson.phone,
        }
      : null,
    q.id,
  );

  const rows: StatusRow[] = [
    {
      label: "Kunde",
      value: (
        <Link href={`/kunden/${q.customer.id}`} className="text-indigo-600 hover:underline">
          {q.customer.name}
        </Link>
      ),
    },
  ];
  if (contact) rows.push({ label: "Ansprechpartner", value: `${contact.firstName} ${contact.lastName}`.trim() });
  rows.push({
    label: "Rechnungsadresse",
    value: (
      <span className="block text-right">
        <span className="block">{buyer.addressLine1}</span>
        <span className="block">
          {buyer.postalCode} {buyer.city}
        </span>
      </span>
    ),
  });
  if (q.subject) rows.push({ label: "Betreff", value: q.subject });
  if (q.customerReference) rows.push({ label: "Kundenreferenz", value: q.customerReference });
  rows.push({ label: "Datum", value: deDate(q.issueDate) });
  if (q.validUntil) rows.push({ label: "Gültig bis", value: deDate(q.validUntil) });
  if (q.deliveryTerms) rows.push({ label: "Lieferbedingungen", value: q.deliveryTerms });
  if (q.paymentTerms) rows.push({ label: "Zahlungsbedingungen", value: q.paymentTerms });
  rows.push({ label: "Netto", value: formatCents(q.netTotalCents, q.currency) });
  rows.push({ label: "USt", value: formatCents(q.taxTotalCents, q.currency) });
  rows.push({ label: "Brutto", value: <strong>{formatCents(q.grossTotalCents, q.currency)}</strong> });

  return (
    <StatusCard status={<StatusBadge status={status} />} rows={rows}>
      <div className="space-y-4">{children}</div>
    </StatusCard>
  );
}
