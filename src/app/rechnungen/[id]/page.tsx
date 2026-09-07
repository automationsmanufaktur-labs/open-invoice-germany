import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents, formatQuantity } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { finalizeAction, cancelAction } from "@/app/actions/invoices";
import { PaymentForm } from "@/components/PaymentForm";
import { DunningButton } from "@/components/DunningButton";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import { DUNNING_LEVEL_TITLE } from "@/lib/dunning";
import type { EmailDocType } from "@/schemas/email";

export const dynamic = "force-dynamic";

const TYPE_TITLE: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift / Storno",
  CORRECTION: "Korrekturrechnung",
};

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export default async function InvoiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } },
      customer: true,
      org: true,
      payments: true,
      dunnings: { orderBy: { level: "asc" } },
    },
  });
  if (!invoice) notFound();

  const isDraft = invoice.status === "DRAFT";
  const isCancelled = invoice.status === "CANCELLED";
  const breakdown = JSON.parse(invoice.taxBreakdownJson) as Array<{ taxRate: number; netCents: number; taxCents: number }>;
  const isInvoiceType = invoice.type === "INVOICE" || invoice.type === "CORRECTION";
  const openCents = invoice.grossTotalCents - invoice.paidAmountCents;
  const dueDate = invoice.dueDate ?? invoice.issueDate;
  const isOverdue = !isDraft && !isCancelled && openCents > 0 && new Date() > dueDate;
  const canPay = !isDraft && !isCancelled && isInvoiceType && openCents > 0;
  const emailDocType: EmailDocType = invoice.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/rechnungen" className="text-sm text-slate-500 hover:text-slate-800">
            ← Rechnungen
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {TYPE_TITLE[invoice.type] ?? "Beleg"} {invoice.number ?? "(Entwurf)"}
          </h1>
          <StatusBadge status={invoice.status} />
          {invoice.snapshotSource === "MIGRATION" && (
            <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Adressstand per Migration eingefroren
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF
          </a>
          {!isDraft && (
            <a
              href={`/api/invoices/${invoice.id}/xrechnung`}
              target="_blank"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              XRechnung (XML)
            </a>
          )}
          {!isDraft && (
            <a
              href={`/api/invoices/${invoice.id}/zugferd`}
              target="_blank"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ZUGFeRD (PDF)
            </a>
          )}
          <SendEmailDialog docType={emailDocType} docId={invoice.id} label={isDraft ? "Entwurf per E-Mail senden" : "Per E-Mail senden"} />
          {isDraft && (
            <form action={finalizeAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                Festschreiben
              </button>
            </form>
          )}
          {!isDraft && !isCancelled && invoice.type === "INVOICE" && (
            <Link
              href={`/rechnungen/${invoice.id}/teilgutschrift`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Teilgutschrift
            </Link>
          )}
          {!isDraft && !isCancelled && invoice.type === "INVOICE" && (
            <form action={cancelAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50">
                Stornieren
              </button>
            </form>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm whitespace-pre-line text-rose-800">{error}</div>
      )}
      {isDraft && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Entwurf — noch keine Rechnungsnummer vergeben. Mit „Festschreiben“ wird die Rechnung GoBD-konform unveränderbar.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Empfänger</h2>
          <p className="text-slate-700">{invoice.customer.name}</p>
          <p className="text-slate-600">{invoice.customer.addressLine1}</p>
          <p className="text-slate-600">
            {invoice.customer.postalCode} {invoice.customer.city}
          </p>
          {invoice.customer.vatId && <p className="text-slate-500">USt-IdNr.: {invoice.customer.vatId}</p>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Eckdaten</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-slate-600">
            <dt>Rechnungsdatum</dt>
            <dd className="text-right">{deDate(invoice.issueDate)}</dd>
            <dt>Leistungsdatum</dt>
            <dd className="text-right">{deDate(invoice.deliveryDate)}</dd>
            <dt>Fällig</dt>
            <dd className="text-right">{deDate(invoice.dueDate)}</dd>
            <dt>Steuerschema</dt>
            <dd className="text-right">{invoice.taxScheme}</dd>
          </dl>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Beschreibung</th>
              <th className="px-4 py-2 text-right">Menge</th>
              <th className="px-4 py-2 text-right">Einzel</th>
              <th className="px-4 py-2 text-right">USt</th>
              <th className="px-4 py-2 text-right">Netto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 text-slate-700">{l.description}</td>
                <td className="tabular px-4 py-2 text-right">
                  {formatQuantity(l.quantityMilli)} {l.unit}
                </td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.unitNetPriceCents, invoice.currency)}</td>
                <td className="tabular px-4 py-2 text-right">{l.taxRate}%</td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.lineNetCents, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Netto</span>
          <span className="tabular font-medium">{formatCents(invoice.netTotalCents, invoice.currency)}</span>
        </div>
        {breakdown
          .filter((b) => b.taxCents > 0)
          .map((b) => (
            <div key={b.taxRate} className="flex justify-between text-slate-600">
              <span>zzgl. {b.taxRate}% USt</span>
              <span className="tabular">{formatCents(b.taxCents, invoice.currency)}</span>
            </div>
          ))}
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
          <span>Gesamt</span>
          <span className="tabular">{formatCents(invoice.grossTotalCents, invoice.currency)}</span>
        </div>
      </div>

      {invoice.notes && <p className="text-sm text-slate-600">{invoice.notes}</p>}

      {invoice.internalNotes && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="mr-2 font-medium">Interne Notiz</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">nur intern sichtbar</span>
          <p className="mt-1 whitespace-pre-line">{invoice.internalNotes}</p>
        </div>
      )}

      {isInvoiceType && !isDraft && !isCancelled && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-slate-900">Zahlung & Mahnwesen</h2>
            <span className="text-sm text-slate-600">
              Bezahlt: {formatCents(invoice.paidAmountCents, invoice.currency)} · Offen:{" "}
              <strong>{formatCents(openCents, invoice.currency)}</strong>
              {isOverdue && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">überfällig</span>}
            </span>
          </div>

          {canPay && <PaymentForm invoiceId={invoice.id} openCents={openCents} />}

          {openCents > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <DunningButton invoiceId={invoice.id} />
              {!isOverdue && <span className="text-xs text-slate-400">Fällig am {deDate(dueDate)}</span>}
            </div>
          )}

          {invoice.dunnings.length > 0 && (
            <div className="space-y-1 text-sm">
              {invoice.dunnings.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1 text-slate-600">
                  <span>
                    {DUNNING_LEVEL_TITLE[d.level] ?? `${d.level}. Mahnung`} · {d.number} · {deDate(d.sentAt)}
                    {d.interestAmountCents > 0 ? ` · Zinsen ${formatCents(d.interestAmountCents, invoice.currency)}` : ""}
                    {d.flatFee40Cents > 0 ? ` · Pauschale ${formatCents(d.flatFee40Cents, invoice.currency)}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <a href={`/api/dunnings/${d.id}/pdf`} target="_blank" className="text-indigo-600 hover:underline">
                      PDF
                    </a>
                    <SendEmailDialog docType="DUNNING" docId={d.id} label="Mahnung senden" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <EmailHistory docType={emailDocType} docId={invoice.id} />
    </div>
  );
}
