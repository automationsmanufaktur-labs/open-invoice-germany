import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents, formatQuantity } from "@/lib/money";
import { intervalLabel } from "@/lib/recurring";
import { StatusBadge } from "@/components/StatusBadge";
import { RecurringActions } from "@/components/RecurringActions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "aktiv", cls: "bg-emerald-100 text-emerald-800" },
  PAUSED: { text: "pausiert", cls: "bg-amber-100 text-amber-800" },
  ENDED: { text: "beendet", cls: "bg-slate-200 text-slate-600" },
};

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export default async function AboDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await prisma.recurringInvoice.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { position: "asc" } },
      invoices: { orderBy: { issueDate: "desc" }, include: { customer: { select: { name: true } } } },
    },
  });
  if (!rec) notFound();

  const net = rec.lines.reduce((s, l) => s + Math.round((l.quantityMilli * l.unitNetPriceCents) / 1000), 0);
  const s = STATUS_LABEL[rec.status] ?? { text: rec.status, cls: "bg-slate-100 text-slate-600" };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/abos" className="text-sm text-slate-500 hover:text-slate-800">
            ← Abos
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{rec.title}</h1>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>
        </div>
        <RecurringActions id={rec.id} status={rec.status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Kunde</h2>
          <p className="text-slate-700">{rec.customer.name}</p>
          <p className="text-slate-600">{rec.customer.addressLine1}</p>
          <p className="text-slate-600">
            {rec.customer.postalCode} {rec.customer.city}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Plan</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-slate-600">
            <dt>Rhythmus</dt>
            <dd className="text-right">{intervalLabel(rec.interval, rec.intervalCount)}</dd>
            <dt>Start</dt>
            <dd className="text-right">{deDate(rec.startDate)}</dd>
            <dt>Nächste Rechnung</dt>
            <dd className="text-right font-medium text-slate-800">{rec.status === "ENDED" ? "—" : deDate(rec.nextRunDate)}</dd>
            <dt>Ende</dt>
            <dd className="text-right">{deDate(rec.endDate)}</dd>
            <dt>Zahlungsziel</dt>
            <dd className="text-right">{rec.paymentTermsDays} Tage</dd>
            <dt>Festschreiben</dt>
            <dd className="text-right">{rec.autoFinalize ? "automatisch" : "manuell"}</dd>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rec.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 text-slate-700">{l.description}</td>
                <td className="tabular px-4 py-2 text-right">
                  {formatQuantity(l.quantityMilli)} {l.unit}
                </td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.unitNetPriceCents, rec.currency)}</td>
                <td className="tabular px-4 py-2 text-right">{l.taxRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ml-auto max-w-xs text-sm">
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
          <span>Netto je Rechnung</span>
          <span className="tabular">{formatCents(net, rec.currency)}</span>
        </div>
      </div>

      {rec.notes && <p className="text-sm text-slate-600">{rec.notes}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">Erzeugte Rechnungen ({rec.invoices.length})</h2>
        {rec.invoices.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Rechnung erzeugt.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Nummer / Entwurf</th>
                  <th className="px-4 py-2">Rechnungsdatum</th>
                  <th className="px-4 py-2">Leistungsdatum</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Brutto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rec.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/rechnungen/${inv.id}`} className="font-medium text-indigo-600 hover:underline">
                        {inv.number ?? "Entwurf"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{deDate(inv.issueDate)}</td>
                    <td className="px-4 py-2 text-slate-600">{deDate(inv.deliveryDate)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="tabular px-4 py-2 text-right">{formatCents(inv.grossTotalCents, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
