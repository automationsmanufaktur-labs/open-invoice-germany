import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents, formatQuantity } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { finalizeAction, cancelAction } from "@/app/actions/invoices";

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
    include: { lines: { orderBy: { position: "asc" } }, customer: true, org: true },
  });
  if (!invoice) notFound();

  const isDraft = invoice.status === "DRAFT";
  const isCancelled = invoice.status === "CANCELLED";
  const breakdown = JSON.parse(invoice.taxBreakdownJson) as Array<{ taxRate: number; netCents: number; taxCents: number }>;

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
          {isDraft && (
            <form action={finalizeAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                Festschreiben
              </button>
            </form>
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
    </div>
  );
}
