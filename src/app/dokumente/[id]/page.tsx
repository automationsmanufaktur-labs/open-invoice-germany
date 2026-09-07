import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { effectiveQuoteStatus } from "@/domain/document/status";
import { billingStateFor } from "@/domain/document/billing-state";
import { StatusBadge, BillingStateBadge } from "@/components/StatusBadge";
import { DocumentActions } from "@/components/DocumentActions";
import { ConvertMenu } from "@/components/ConvertMenu";
import { DocumentChain } from "@/components/DocumentChain";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import { ShareLinkPanel } from "@/components/ShareLinkPanel";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { listAttachments } from "@/domain/attachment/manage";
import { LineItemsTable } from "@/components/LineItemsTable";
import type { EmailDocType } from "@/schemas/email";

export const dynamic = "force-dynamic";

const KIND_TITLE: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma-Rechnung",
};

// Client-seitige Kopie der Statuslisten aus src/domain/document/convert.ts (dort nicht
// importierbar, weil die Datei dbInternal fuer den Schreibpfad laedt) — steuert nur, welche
// ConvertMenu-Optionen angeboten werden; die eigentliche Pruefung bleibt serverseitig
// (ConvertError/409 bei Verstoss, W2 Fix-Runde 2).
const ANGEBOT_TO_AB_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);
const ANGEBOT_TO_INVOICE_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);
const AB_TO_INVOICE_STATUSES = new Set(["DRAFT", "SENT"]);
const QUOTE_TO_DELIVERY_NOTE_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);

export default async function DokumentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const q = await dbInternal.quote.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } }, customer: true, contactPerson: true, billingAddress: true },
  });
  if (!q) notFound();

  const status = effectiveQuoteStatus({ status: q.status, validUntil: q.validUntil });
  const billing = q.kind !== "PROFORMA" ? await billingStateFor(org.id, "QUOTE", q.id) : null;
  const archived = q.archivedAt !== null;
  const attachments = await listAttachments(org.id, "QUOTE", q.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/dokumente" className="text-sm text-slate-500 hover:text-slate-800">
            ← Dokumente
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {KIND_TITLE[q.kind] ?? "Dokument"} {q.number ?? "(Entwurf)"}
          </h1>
          <StatusBadge status={status} />
          {billing && <BillingStateBadge state={billing.state} />}
          {archived && <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Archiviert</span>}
          {q.snapshotSource === "MIGRATION" && (
            <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Adressstand per Migration eingefroren
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/documents/${q.id}/pdf`}
            target="_blank"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF
          </a>
          <SendEmailDialog docType={q.kind as EmailDocType} docId={q.id} />
          {q.convertedToInvoiceId && (
            <Link href={`/rechnungen/${q.convertedToInvoiceId}`} className="text-sm font-medium text-indigo-600 hover:underline">
              → zur Rechnung
            </Link>
          )}
          {/* G8 (Fix-Runde 2): ConvertMenu bleibt auch nach Umwandlung in eine Rechnung
              sichtbar — ein Lieferschein (Teilmengen) kann weiterhin erzeugt werden, nur
              die Rechnungs-/AB-Optionen ergeben nach der Umwandlung keinen Sinn mehr.
              W2: jede Option nur bei einem fuer die Konvertierung zulaessigen Status. */}
          <ConvertMenu
            sourceType="QUOTE"
            sourceId={q.id}
            showToOrderConfirmation={q.kind === "ANGEBOT" && !q.convertedToInvoiceId && ANGEBOT_TO_AB_STATUSES.has(status)}
            showToInvoice={
              !q.convertedToInvoiceId &&
              ((q.kind === "ANGEBOT" && ANGEBOT_TO_INVOICE_STATUSES.has(status)) || (q.kind === "AUFTRAGSBESTAETIGUNG" && AB_TO_INVOICE_STATUSES.has(status)))
            }
            showToDeliveryNote={QUOTE_TO_DELIVERY_NOTE_STATUSES.has(status)}
          />
        </div>
      </div>

      <DocumentActions type="QUOTE" id={q.id} status={status} archived={archived} editHref={`/dokumente/${q.id}/bearbeiten`} />

      {q.kind === "PROFORMA" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Proforma-Rechnung — keine Rechnung im Sinne des § 14 UStG, berechtigt nicht zum Vorsteuerabzug.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Empfänger</h2>
          <p className="text-slate-700">{q.customer.name}</p>
          {q.contactPerson && (
            <p className="text-slate-600">
              {q.contactPerson.firstName} {q.contactPerson.lastName}
            </p>
          )}
          {q.billingAddress ? (
            <>
              <p className="text-slate-600">{q.billingAddress.addressLine1}</p>
              <p className="text-slate-600">
                {q.billingAddress.postalCode} {q.billingAddress.city}
              </p>
            </>
          ) : (
            <>
              <p className="text-slate-600">{q.customer.addressLine1}</p>
              <p className="text-slate-600">
                {q.customer.postalCode} {q.customer.city}
              </p>
            </>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Eckdaten</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-slate-600">
            {q.subject && (
              <>
                <dt>Betreff</dt>
                <dd className="text-right">{q.subject}</dd>
              </>
            )}
            {q.customerReference && (
              <>
                <dt>Kundenreferenz</dt>
                <dd className="text-right">{q.customerReference}</dd>
              </>
            )}
            {q.deliveryTerms && (
              <>
                <dt>Lieferbedingungen</dt>
                <dd className="text-right">{q.deliveryTerms}</dd>
              </>
            )}
            {q.paymentTerms && (
              <>
                <dt>Zahlungsbedingungen</dt>
                <dd className="text-right">{q.paymentTerms}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {q.headerText && <p className="whitespace-pre-line text-sm text-slate-700">{q.headerText}</p>}

      <LineItemsTable lines={q.lines} currency={q.currency} />

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Netto</span>
          <span className="tabular font-medium">{formatCents(q.netTotalCents, q.currency)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>zzgl. USt</span>
          <span className="tabular">{formatCents(q.taxTotalCents, q.currency)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
          <span>Gesamt</span>
          <span className="tabular">{formatCents(q.grossTotalCents, q.currency)}</span>
        </div>
      </div>

      {q.footerText && <p className="whitespace-pre-line text-sm text-slate-700">{q.footerText}</p>}
      {q.notes && <p className="text-sm text-slate-600">{q.notes}</p>}

      {q.internalNotes && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="mr-2 font-medium">Interne Notiz</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">nur intern sichtbar</span>
          <p className="mt-1 whitespace-pre-line">{q.internalNotes}</p>
        </div>
      )}

      {q.kind === "ANGEBOT" && (status === "DRAFT" || status === "SENT" || status === "EXPIRED") && <ShareLinkPanel documentId={q.id} />}

      <AttachmentPanel docType="QUOTE" docId={q.id} initial={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))} />

      <DocumentChain orgId={org.id} type="QUOTE" id={q.id} />

      <EmailHistory docType={q.kind as EmailDocType} docId={q.id} />
    </div>
  );
}
