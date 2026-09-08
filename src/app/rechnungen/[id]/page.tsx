import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { formatCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { finalizeAction } from "@/app/actions/invoices";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { dunningScheduleFor, latestDunning } from "@/domain/dunning/schedule";
import { loadDunningSettings } from "@/domain/dunning/settings";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import { DocumentChain } from "@/components/DocumentChain";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { listAttachments } from "@/domain/attachment/manage";
import { LineItemsTable } from "@/components/LineItemsTable";
import { DocumentTimeline } from "@/components/DocumentTimeline";
import { DocumentDetailLayout } from "@/components/detail/DocumentDetailLayout";
import { DetailNav } from "@/components/detail/DetailNav";
import { PdfStack } from "@/components/detail/PdfStack";
import { CollapsibleSection } from "@/components/detail/CollapsibleSection";
import { InternalNotesBox } from "@/components/detail/InternalNotesBox";
import { loadNeighbors } from "@/domain/document/neighbors";
import { buildInvoiceViewModel, TYPE_TITLE } from "./_parts/invoice-view-model";
import { InvoiceStatusCard } from "./_parts/InvoiceStatusCard";
import { InvoiceMoreMenu } from "./_parts/InvoiceMoreMenu";
import { InvoiceTotals } from "./_parts/InvoiceTotals";
import { CorrectionSection } from "./_parts/CorrectionSection";

export const dynamic = "force-dynamic";

export default async function InvoiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; liste?: string | string[] }>;
}) {
  const { id } = await params;
  const { error, liste: listeParam } = await searchParams;
  const liste = firstOf(listeParam);

  const org = await getActiveOrg();
  // G7 (Fix-Runde 2): findUnique(id) ohne orgId erlaubte fremden Organisationen den Zugriff
  // auf eine Rechnungsseite ueber die reine ID — jetzt mandantengeprueft.
  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId: org.id },
    include: {
      lines: { orderBy: { position: "asc" } },
      customer: { include: { defaultPaymentMethod: true } },
      org: true,
      payments: { orderBy: { paidAt: "asc" } },
      dunnings: { orderBy: { level: "asc" }, include: { stage: { select: { order: true, name: true } } } },
      paymentMethod: true,
      // Task 4: Abzugs-Snapshot einer Schlussrechnung (Task 2, FinalInvoiceDeduction) —
      // NIE live aus den Abschlagsrechnungen, nur dieser unveraenderliche Snapshot.
      finalDeductions: { orderBy: { issueDate: "asc" } },
    },
  });
  if (!invoice) notFound();

  const vm = buildInvoiceViewModel(invoice);

  // Task 4: Bezug zur Quelle (Angebot/AB bzw. Lieferschein) bei PARTIAL/DOWNPAYMENT/FINAL.
  let sourceLabel: { href: string; text: string } | null = null;
  if (invoice.sourceType === "QUOTE" && invoice.sourceId) {
    const src = await prisma.quote.findFirst({ where: { id: invoice.sourceId, orgId: org.id }, select: { number: true, kind: true } });
    if (src) {
      const kindLabel = src.kind === "AUFTRAGSBESTAETIGUNG" ? "Auftragsbestätigung" : src.kind === "PROFORMA" ? "Proforma-Rechnung" : "Angebot";
      sourceLabel = { href: `/dokumente/${invoice.sourceId}`, text: `${kindLabel} ${src.number ?? ""}`.trim() };
    }
  } else if (invoice.sourceType === "DELIVERY_NOTE" && invoice.sourceId) {
    const src = await prisma.deliveryNote.findFirst({ where: { id: invoice.sourceId, orgId: org.id }, select: { number: true } });
    if (src) sourceLabel = { href: `/lieferscheine/${invoice.sourceId}`, text: `Lieferschein ${src.number ?? ""}`.trim() };
  }

  // Task 4: Mahnblock — naechste Stufe/Faelligkeit ueber dieselbe reine Zeitplan-Logik
  // wie createDunning (dunningScheduleFor), damit die Anzeige exakt dem entspricht, was
  // die naechste Erstellung tatsaechlich anwenden wuerde.
  let dunningSchedule: { nextStage: { name: string; order: number } | null; dueAt: Date | null; isDue: boolean } | null = null;
  if (vm.openCents > 0 && !vm.isDraft && !vm.isCancelled) {
    const dunningStages = await prisma.dunningStage.findMany({ where: { orgId: org.id }, select: { order: true, enabled: true, daysAfterDue: true, name: true } });
    const dunningSettings = await loadDunningSettings(org.id);
    // Nit (Fix-Welle): `latestDunning` statt "letztes Element nach orderBy level asc" —
    // nach einem Umsortieren der Mahnstufen (S3) ist `level`/`stage.order` nicht mehr
    // zuverlaessig die zeitliche Reihenfolge; einheitlich mit create.ts/auto.ts.
    const lastDunning = latestDunning(invoice.dunnings);
    const schedule = dunningScheduleFor({
      invoiceDueDate: vm.dueDate,
      lastDunning: lastDunning ? { order: lastDunning.stage?.order ?? lastDunning.level, dueDate: lastDunning.dueDate, sentAt: lastDunning.sentAt } : null,
      stages: dunningStages,
      gracePeriodDays: dunningSettings.gracePeriodDays,
      now: new Date(),
    });
    dunningSchedule = { nextStage: schedule.nextStage ? { name: schedule.nextStage.name, order: schedule.nextStage.order } : null, dueAt: schedule.dueAt, isDue: schedule.isDue };
  }

  // Zahlungsmethoden-Auswahl im Zahlungsformular: aktive Methoden OHNE den Systemcode
  // SKONTO (der wird ausschliesslich automatisch bei detectSkonto gebucht, nie manuell
  // ausgewaehlt). Default-Kette: Kunden-Standard -> Methode der Rechnung -> TRANSFER.
  const activePaymentMethods = vm.canPay
    ? (await listPaymentMethods(org.id)).filter((m) => m.isActive && m.code !== "SKONTO")
    : [];
  const defaultPaymentMethodCode = invoice.customer.defaultPaymentMethod?.code ?? invoice.paymentMethod?.code ?? "TRANSFER";
  const attachments = await listAttachments(org.id, "INVOICE", invoice.id);

  const { prevId, nextId, backQuery } = await loadNeighbors("INVOICE", org.id, id, liste);
  const navHref = (targetId: string) => `/rechnungen/${targetId}${liste ? `?liste=${encodeURIComponent(liste)}` : ""}`;

  const title = `${TYPE_TITLE[invoice.type] ?? "Beleg"} ${invoice.number ?? "(Entwurf)"}`;
  const showPaymentBlock = vm.isInvoiceType && !vm.isDraft && !vm.isCancelled;

  return (
    <DocumentDetailLayout
      nav={
        <DetailNav
          backHref={`/rechnungen${backQuery ? `?${backQuery}` : ""}`}
          backLabel="Rechnungen"
          prevHref={prevId ? navHref(prevId) : null}
          nextHref={nextId ? navHref(nextId) : null}
        />
      }
      title={title}
      badges={
        <>
          <StatusBadge status={invoice.status} />
          {sourceLabel && (
            <Link href={sourceLabel.href} className="text-sm text-indigo-600 hover:underline">
              zu {sourceLabel.text}
            </Link>
          )}
          {invoice.snapshotSource === "MIGRATION" && (
            <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Adressstand per Migration eingefroren
            </span>
          )}
        </>
      }
      actions={
        <>
          {/* I1 (Fix-Welle): PDF-Knopf wie auf Dokument-/Lieferscheinseite — rendert auch Entwuerfe. */}
          <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            PDF
          </a>
          <SendEmailDialog docType={vm.emailDocType} docId={invoice.id} label={vm.isDraft ? "Entwurf per E-Mail senden" : "Per E-Mail senden"} />
          {vm.isDraft && (
            <Link href={`/rechnungen/${invoice.id}/bearbeiten`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Bearbeiten
            </Link>
          )}
          {vm.isDraft && (
            <form action={finalizeAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Festschreiben</button>
            </form>
          )}
          {!vm.isDraft && vm.canPay && (
            <a href="#zahlung" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              Zahlung erfassen
            </a>
          )}
        </>
      }
      more={
        <InvoiceMoreMenu
          invoiceId={invoice.id}
          isDraft={vm.isDraft}
          isCancelled={vm.isCancelled}
          isInvoiceType={vm.isInvoiceType}
          canCancelOrCredit={vm.canCancelOrCredit}
          canDuplicate={vm.canDuplicate}
        />
      }
      notice={
        <>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm whitespace-pre-line text-rose-800">{error}</div>}
          {vm.isDraft && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Entwurf — noch keine Rechnungsnummer vergeben. Mit „Festschreiben“ wird die Rechnung GoBD-konform unveränderbar.
            </div>
          )}
        </>
      }
      pdf={<PdfStack src={`/api/invoices/${invoice.id}/pdf`} title={`${title} — PDF`} />}
      aside={
        <InvoiceStatusCard
          invoice={invoice}
          openCents={vm.openCents}
          dueDate={vm.dueDate}
          isOverdue={vm.isOverdue}
          paymentMethodName={vm.paymentMethodName}
          hasSkonto={vm.hasSkonto}
          showPaymentBlock={showPaymentBlock}
          canPay={vm.canPay}
          paymentMethods={activePaymentMethods.map((m) => ({ code: m.code, name: m.name }))}
          defaultPaymentMethod={defaultPaymentMethodCode}
          dunningSchedule={dunningSchedule}
        >
          <AttachmentPanel
            docType="INVOICE"
            docId={invoice.id}
            initial={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))}
          />
          <DocumentChain orgId={org.id} type="INVOICE" id={invoice.id} />
        </InvoiceStatusCard>
      }
    >
      <InternalNotesBox notes={invoice.internalNotes} />

      <CollapsibleSection title="Positionen" summary={`${invoice.lines.length} ${invoice.lines.length === 1 ? "Position" : "Positionen"} · Netto ${formatCents(invoice.netTotalCents, invoice.currency)}`}>
        <div className="space-y-4">
          {invoice.headerText && <p className="whitespace-pre-line text-sm text-slate-700">{invoice.headerText}</p>}
          <LineItemsTable lines={invoice.lines} currency={invoice.currency} />
          <InvoiceTotals
            currency={invoice.currency}
            type={invoice.type}
            hasDocumentAdjustment={vm.hasDocumentAdjustment}
            documentDiscountTotalCents={vm.documentDiscountTotalCents}
            documentChargeTotalCents={vm.documentChargeTotalCents}
            documentChargeReason={invoice.documentChargeReason}
            netTotalCents={invoice.netTotalCents}
            breakdown={vm.breakdown}
            grossTotalCents={invoice.grossTotalCents}
            payableBase={vm.payableBase}
            deductionsByInvoice={vm.deductionsByInvoice}
          />
          {invoice.footerText && <p className="whitespace-pre-line text-sm text-slate-700">{invoice.footerText}</p>}
          {invoice.notes && <p className="text-sm text-slate-600">{invoice.notes}</p>}
        </div>
      </CollapsibleSection>

      {!vm.isDraft && !vm.isCancelled && (
        <CorrectionSection invoiceId={invoice.id} type={invoice.type} canCancelOrCredit={vm.canCancelOrCredit} canDuplicate={vm.canDuplicate} />
      )}

      <EmailHistory docType={vm.emailDocType} docId={invoice.id} />

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">Zeitstrahl</h2>
        <DocumentTimeline kind="INVOICE" docId={invoice.id} />
      </section>
    </DocumentDetailLayout>
  );
}

// M11 (Fix-Welle): `?liste=a&liste=b` liefert `string[]` — Ableitung wie auf den Listenseiten.
function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
