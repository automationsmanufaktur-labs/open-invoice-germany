import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { effectiveQuoteStatus } from "@/domain/document/status";
import { billingStateFor } from "@/domain/document/billing-state";
import { StatusBadge, BillingStateBadge } from "@/components/StatusBadge";
import { DocumentActions } from "@/components/DocumentActions";
import { DocumentActionsMenuItems } from "@/components/DocumentActionsMenu";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import { ShareLinkPanel } from "@/components/ShareLinkPanel";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { listAttachments } from "@/domain/attachment/manage";
import { LineItemsTable } from "@/components/LineItemsTable";
import { DocumentChain } from "@/components/DocumentChain";
import { DocumentTimeline } from "@/components/DocumentTimeline";
import { DocumentDetailLayout } from "@/components/detail/DocumentDetailLayout";
import { DetailNav } from "@/components/detail/DetailNav";
import { PdfStack } from "@/components/detail/PdfStack";
import { CollapsibleSection } from "@/components/detail/CollapsibleSection";
import { InternalNotesBox } from "@/components/detail/InternalNotesBox";
import { ActionMenu } from "@/components/detail/ActionMenu";
import { NavHint } from "@/components/shell/NavHint";
import { loadNeighbors } from "@/domain/document/neighbors";
import type { EmailDocType } from "@/schemas/email";
import { DocumentStatusCard } from "./_parts/DocumentStatusCard";
import { DocumentMoreMenu } from "./_parts/DocumentMoreMenu";

export const dynamic = "force-dynamic";

const KIND_TITLE: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma-Rechnung",
};
// Plural fuers Zurueck-Label der DetailNav (11a-M12-Nachbar, Task-4-Ruling).
const KIND_TITLE_PLURAL: Record<string, string> = {
  ANGEBOT: "Angebote",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigungen",
  PROFORMA: "Proforma",
};

// Client-seitige Kopie der Statuslisten aus src/domain/document/convert.ts (dort nicht
// importierbar, weil die Datei dbInternal fuer den Schreibpfad laedt) — steuert nur, welche
// ConvertMenu-Optionen angeboten werden; die eigentliche Pruefung bleibt serverseitig
// (ConvertError/409 bei Verstoss, W2 Fix-Runde 2).
const ANGEBOT_TO_AB_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);
const ANGEBOT_TO_INVOICE_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);
const AB_TO_INVOICE_STATUSES = new Set(["DRAFT", "SENT"]);
const QUOTE_TO_DELIVERY_NOTE_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);

export default async function DokumentDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ liste?: string | string[] }>;
}) {
  const { id } = await params;
  const liste = firstOf((await searchParams).liste);
  const org = await getActiveOrg();
  const q = await dbInternal.quote.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } }, customer: true, contactPerson: true, billingAddress: true },
  });
  if (!q) notFound();

  const status = effectiveQuoteStatus({ status: q.status, validUntil: q.validUntil });
  const billing = q.kind !== "PROFORMA" ? await billingStateFor(org.id, "QUOTE", q.id) : null;
  // Task 4: Teil-/Abschlags-/Schlussrechnung nur fuer Angebot/AB, solange noch nicht
  // voll abgerechnet — Teil- und Abschlagsrechnungen werden nie gemischt (Task-2-Ruling).
  const canBillQuote = q.kind !== "PROFORMA" && QUOTE_TO_DELIVERY_NOTE_STATUSES.has(status) && billing != null && billing.state !== "FULL";
  const hasPartialInvoices = billing != null && billing.state === "PARTIAL" && billing.downpaymentGrossCents === 0;
  const hasDownpayments = billing != null && billing.downpaymentGrossCents > 0;
  const archived = q.archivedAt !== null;
  const attachments = await listAttachments(org.id, "QUOTE", q.id);

  const { prevId, nextId, backQuery } = await loadNeighbors("QUOTE", org.id, id, liste);
  const navHref = (targetId: string) => `/dokumente/${targetId}${liste ? `?liste=${encodeURIComponent(liste)}` : ""}`;

  const title = `${KIND_TITLE[q.kind] ?? "Dokument"} ${q.number ?? "(Entwurf)"}`;

  return (
    <>
      <NavHint href={`/dokumente?kind=${q.kind}`} />
      <DocumentDetailLayout
        nav={
          <DetailNav
            backHref={`/dokumente${backQuery ? `?${backQuery}` : ""}`}
            backLabel={KIND_TITLE_PLURAL[q.kind] ?? "Dokumente"}
            prevHref={prevId ? navHref(prevId) : null}
            nextHref={nextId ? navHref(nextId) : null}
          />
        }
        title={title}
        badges={
          <>
            <StatusBadge status={status} />
            {billing && <BillingStateBadge state={billing.state} billedPermille={billing.billedPermille} />}
            {archived && <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Archiviert</span>}
            {q.snapshotSource === "MIGRATION" && (
              <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                Adressstand per Migration eingefroren
              </span>
            )}
          </>
        }
        actions={
          <>
            {/* Fix-Welle I2: kompakte Kopfzeile — nur Bearbeiten + der erste verfuegbare
                Statusuebergang; der Rest wandert per DocumentActionsMenuItems ins "Mehr"-Menue. */}
            <DocumentActions type="QUOTE" id={q.id} status={status} archived={archived} editHref={`/dokumente/${q.id}/bearbeiten`} variant="compact" />
            <a
              href={`/api/documents/${q.id}/pdf`}
              target="_blank"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              PDF
            </a>
            <SendEmailDialog docType={q.kind as EmailDocType} docId={q.id} />
          </>
        }
        more={
          <ActionMenu>
            <DocumentActionsMenuItems type="QUOTE" id={q.id} status={status} archived={archived} />
            <DocumentMoreMenu
              quoteId={q.id}
              convertedToInvoiceId={q.convertedToInvoiceId}
              showToOrderConfirmation={q.kind === "ANGEBOT" && !q.convertedToInvoiceId && ANGEBOT_TO_AB_STATUSES.has(status)}
              showToInvoice={
                !q.convertedToInvoiceId &&
                ((q.kind === "ANGEBOT" && ANGEBOT_TO_INVOICE_STATUSES.has(status)) ||
                  (q.kind === "AUFTRAGSBESTAETIGUNG" && AB_TO_INVOICE_STATUSES.has(status)))
              }
              showToDeliveryNote={QUOTE_TO_DELIVERY_NOTE_STATUSES.has(status)}
              // Task 4 (Phase 5, §13-15 UStG): nur solange die Gesamtleistung noch nicht voll
              // abgerechnet ist; hasDownpayments/hasPartialInvoices blenden hier nur die
              // jeweils andere Art aus, die endgueltige Pruefung bleibt serverseitig (409).
              showPartialInvoice={canBillQuote && !hasDownpayments}
              showDownpaymentInvoice={canBillQuote && !hasPartialInvoices}
              showFinalInvoice={billing != null && hasDownpayments && !billing.hasActiveFinal}
            />
          </ActionMenu>
        }
        notice={
          q.kind === "PROFORMA" ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Proforma-Rechnung — keine Rechnung im Sinne des § 14 UStG, berechtigt nicht zum Vorsteuerabzug.
            </div>
          ) : undefined
        }
        pdf={<PdfStack src={`/api/documents/${q.id}/pdf`} title={`${title} — PDF`} />}
        aside={
          <DocumentStatusCard q={q} status={status}>
            {q.kind === "ANGEBOT" && (status === "DRAFT" || status === "SENT" || status === "EXPIRED") && <ShareLinkPanel documentId={q.id} />}
            <AttachmentPanel
              docType="QUOTE"
              docId={q.id}
              initial={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))}
            />
            <DocumentChain orgId={org.id} type="QUOTE" id={q.id} />
          </DocumentStatusCard>
        }
      >
        <InternalNotesBox notes={q.internalNotes} />

        <CollapsibleSection
          title="Positionen"
          summary={`${q.lines.length} ${q.lines.length === 1 ? "Position" : "Positionen"} · Netto ${formatCents(q.netTotalCents, q.currency)}`}
        >
          <div className="space-y-4">
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
          </div>
        </CollapsibleSection>

        <EmailHistory docType={q.kind as EmailDocType} docId={q.id} />

        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">Zeitstrahl</h2>
          <DocumentTimeline kind="QUOTE" docId={q.id} />
        </section>
      </DocumentDetailLayout>
    </>
  );
}

// M11 (Fix-Welle): Next liefert bei doppeltem `?liste=`-Query-Parameter ein `string[]` statt
// `string` — dieselbe Ableitung wie auf den Listenseiten (z. B. `rechnungen/page.tsx`).
function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
