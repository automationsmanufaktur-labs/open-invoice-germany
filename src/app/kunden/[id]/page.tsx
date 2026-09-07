import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { customerOverview } from "@/domain/customer/overview";
import { NotFoundError } from "@/domain/errors";
import { CustomerTabs } from "@/components/customers/CustomerTabs";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

function deDate(d: Date) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(d);
}

/**
 * Kunden-Detailseite (Phase 8b, Task 4, Facts): `/kunden/[id]` ist ab jetzt die
 * Uebersicht (KPIs + Belegtabs), die 8a-Stammdatenformulare wandern nach
 * `/kunden/[id]/bearbeiten`.
 */
export default async function KundeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  let overview;
  try {
    overview = await customerOverview(org.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const { customer, kpis } = overview;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/kunden" className="text-sm text-slate-500 hover:text-slate-800">
            ← Kunden
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{customer.name}</h1>
          {customer.customerNumber && <span className="text-sm text-slate-400">{customer.customerNumber}</span>}
          {customer.isArchived && <StatusBadge status="ARCHIVED" />}
        </div>
        <Link href={`/kunden/${id}/bearbeiten`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Bearbeiten
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Offener Betrag</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(kpis.openCents)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Davon überfällig</div>
          <div className={`mt-1 text-xl font-semibold ${kpis.overdueCents > 0 ? "text-rose-700" : "text-slate-900"}`}>{formatCents(kpis.overdueCents)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Gesamtumsatz</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(kpis.totalRevenueCents)}</div>
        </div>
      </div>

      <CustomerTabs
        tabs={[
          {
            key: "rechnungen",
            label: `Rechnungen (${overview.invoices.length})`,
            content: (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {overview.invoices.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/rechnungen/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                      {r.number ?? "Entwurf"}
                    </Link>
                    <span className="text-slate-500">{deDate(r.issueDate)}</span>
                    <span className="text-slate-700">{formatCents(r.grossTotalCents)}</span>
                    <StatusBadge status={r.effectiveStatus} />
                  </li>
                ))}
                {overview.invoices.length === 0 && <li className="px-4 py-6 text-center text-slate-400">Keine Rechnungen.</li>}
              </ul>
            ),
          },
          {
            key: "angebote",
            label: `Angebote (${overview.quotes.length})`,
            content: (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {overview.quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/dokumente/${q.id}`} className="font-medium text-indigo-600 hover:underline">
                      {q.number ?? "Entwurf"}
                    </Link>
                    <span className="text-slate-500">{deDate(q.issueDate)}</span>
                    <span className="text-slate-700">{formatCents(q.grossTotalCents)}</span>
                    <StatusBadge status={q.effectiveStatus} />
                  </li>
                ))}
                {overview.quotes.length === 0 && <li className="px-4 py-6 text-center text-slate-400">Keine Angebote.</li>}
              </ul>
            ),
          },
          {
            key: "lieferscheine",
            label: `Lieferscheine (${overview.deliveryNotes.length})`,
            content: (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {overview.deliveryNotes.map((n) => (
                  <li key={n.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/lieferscheine/${n.id}`} className="font-medium text-indigo-600 hover:underline">
                      {n.number ?? "Entwurf"}
                    </Link>
                    <span className="text-slate-500">{deDate(n.issueDate)}</span>
                    <StatusBadge status={n.status} />
                  </li>
                ))}
                {overview.deliveryNotes.length === 0 && <li className="px-4 py-6 text-center text-slate-400">Keine Lieferscheine.</li>}
              </ul>
            ),
          },
          {
            key: "abos",
            label: `Abos (${overview.recurring.length})`,
            content: (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {overview.recurring.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/abos/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                      {r.title}
                    </Link>
                    <span className="text-slate-500">nächste Ausführung {deDate(r.nextRunDate)}</span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
                {overview.recurring.length === 0 && <li className="px-4 py-6 text-center text-slate-400">Keine Abos.</li>}
              </ul>
            ),
          },
        ]}
      />
    </div>
  );
}
