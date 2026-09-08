// src/app/rechnungen/[id]/_parts/InvoiceStatusCard.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusCard, type StatusRow } from "@/components/detail/StatusCard";
import { CollapsibleSection } from "@/components/detail/CollapsibleSection";
import { PaymentForm } from "@/components/PaymentForm";
import { formatCents } from "@/lib/money";
import { deDate, type InvoiceDetail } from "./invoice-view-model";
import { PaymentSection } from "./PaymentSection";

function skontoText(invoice: Pick<InvoiceDetail, "skonto1Permille" | "skonto1Days" | "skonto2Permille" | "skonto2Days">): string {
  const first = `${(invoice.skonto1Permille! / 10).toString().replace(".", ",")} % bei Zahlung innerhalb ${invoice.skonto1Days} Tagen`;
  if (invoice.skonto2Permille != null && invoice.skonto2Days != null) {
    return `${first}, ${(invoice.skonto2Permille / 10).toString().replace(".", ",")} % innerhalb ${invoice.skonto2Days} Tagen.`;
  }
  return `${first}.`;
}

/**
 * Statuskarte der Rechnungsdetailseite (Phase 11d, Task 3, `aside`-Slot) — buendelt die
 * frueheren "Empfänger"/"Eckdaten"-Karten (Z. 254-283) als kompakte Zeilen (Kunde als Link
 * plus Anschrift/USt-IdNr., M2 Fix-Welle — direkt aus `customer`, kein Snapshot auf
 * `Invoice`), das "Zahlung & Mahnwesen"-Bezahlt/Offen (Z. 370-377) als Zeilen sowie
 * unveraendert PaymentForm/Zahlungsliste/Mahnblock (Z. 379-421) und die uebergebenen
 * `children` (AttachmentPanel, DocumentChain).
 *
 * `id="zahlung"` sitzt auf einem umschliessenden Wrapper statt auf CollapsibleSection
 * selbst (kein neues Prop auf dem Task-2-Baustein noetig) — die Primaeraktion "Zahlung
 * erfassen" verlinkt per Fragment (`#zahlung`) dorthin.
 */
export function InvoiceStatusCard({
  invoice,
  openCents,
  dueDate,
  isOverdue,
  paymentMethodName,
  hasSkonto,
  showPaymentBlock,
  canPay,
  paymentMethods,
  defaultPaymentMethod,
  dunningSchedule,
  children,
}: {
  invoice: InvoiceDetail;
  openCents: number;
  /** Faellige Kante (invoice.dueDate ?? invoice.issueDate) — fuer den Mahnblock. */
  dueDate: Date;
  isOverdue: boolean;
  paymentMethodName: string | null;
  hasSkonto: boolean;
  /** isInvoiceType && !isDraft && !isCancelled — schaltet Zahlung/Mahnwesen frei. */
  showPaymentBlock: boolean;
  canPay: boolean;
  paymentMethods: { code: string; name: string }[];
  defaultPaymentMethod: string;
  dunningSchedule: { nextStage: { name: string; order: number } | null; dueAt: Date | null; isDue: boolean } | null;
  children?: ReactNode;
}) {
  // Fix 1 (Review): Bezahlt/Offen gehoerten frueher zum guarded "Zahlung & Mahnwesen"-
  // Abschnitt (isInvoiceType && !isDraft && !isCancelled) — fuer Entwuerfe, Gutschriften und
  // stornierte Rechnungen gibt es keine sinnvolle Bezahlt/Offen-Aussage. Zahlungsmethode
  // gehoerte dagegen in der alten "Eckdaten"-Karte NICHT zu diesem Abschnitt und stand dort
  // unbedingt (nur an `paymentMethodName` geknuepft) — I4 (Fix-Welle) nimmt das zurueck, nachdem
  // eine fruehere Fassung sie faelschlich mitguardete.
  const rows: StatusRow[] = [
    {
      label: "Kunde",
      value: (
        <Link href={`/kunden/${invoice.customer.id}`} className="text-indigo-600 hover:underline">
          {invoice.customer.name}
        </Link>
      ),
    },
    {
      label: "Anschrift",
      value: (
        <span className="block text-right">
          <span className="block">{invoice.customer.addressLine1}</span>
          <span className="block">
            {invoice.customer.postalCode} {invoice.customer.city}
          </span>
        </span>
      ),
    },
    { label: "Rechnungsdatum", value: deDate(invoice.issueDate) },
    { label: "Leistungsdatum", value: deDate(invoice.deliveryDate) },
    { label: "Fällig", value: deDate(invoice.dueDate) },
    { label: "Brutto", value: formatCents(invoice.grossTotalCents, invoice.currency) },
  ];
  if (showPaymentBlock) {
    rows.push(
      { label: "Bezahlt", value: formatCents(invoice.paidAmountCents, invoice.currency) },
      { label: "Offen", value: <strong>{formatCents(openCents, invoice.currency)}</strong> },
    );
  }
  rows.push({ label: "Steuerschema", value: invoice.taxScheme });
  if (invoice.customer.vatId) rows.push({ label: "USt-IdNr.", value: invoice.customer.vatId });
  if (paymentMethodName) rows.push({ label: "Zahlungsmethode", value: paymentMethodName });
  if (hasSkonto) rows.push({ label: "Skonto", value: skontoText(invoice) });

  return (
    <StatusCard
      status={
        <>
          <StatusBadge status={invoice.status} />
          {isOverdue && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">überfällig</span>}
        </>
      }
      rows={rows}
    >
      <div className="space-y-4">
        {showPaymentBlock && (
          <>
            {canPay && (
              <div id="zahlung">
                <CollapsibleSection title="Zahlung erfassen" defaultOpen={canPay}>
                  <PaymentForm invoiceId={invoice.id} openCents={openCents} methods={paymentMethods} defaultMethod={defaultPaymentMethod} />
                </CollapsibleSection>
              </div>
            )}

            {invoice.payments.length > 0 && (
              <div className="space-y-1 text-sm">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1 text-slate-600">
                    <span>
                      {deDate(p.paidAt)} · {formatCents(p.amountCents, invoice.currency)} · {p.method}
                      {p.isSkonto && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Skonto</span>
                      )}
                    </span>
                    {p.reference && <span className="text-xs text-slate-400">{p.reference}</span>}
                  </div>
                ))}
              </div>
            )}

            <PaymentSection
              invoiceId={invoice.id}
              currency={invoice.currency}
              openCents={openCents}
              isOverdue={isOverdue}
              dueDate={dueDate}
              dunningState={invoice.dunningState as "ACTIVE" | "PAUSED" | "STOPPED"}
              dunningPausedUntil={invoice.dunningPausedUntil}
              dunningSchedule={dunningSchedule}
              dunnings={invoice.dunnings}
            />
          </>
        )}
        {children}
      </div>
    </StatusCard>
  );
}
