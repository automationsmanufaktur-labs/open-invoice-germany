import Link from "next/link";
import type { DashboardSummary } from "@/domain/dashboard/summary";
import { formatCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { AgingChart } from "@/components/dashboard/AgingChart";

function deDate(d: Date) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(d);
}

const DOC_HREF: Record<string, (id: string) => string> = {
  INVOICE: (id) => `/rechnungen/${id}`,
  QUOTE: (id) => `/dokumente/${id}`,
  DELIVERY_NOTE: (id) => `/lieferscheine/${id}`,
};

/** Dashboard-Widgets (Task 4, `/`) — Kennzahlkacheln + Aging + letzte Belege. */
export function DashboardWidgets({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/rechnungen?status=open" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">Offen</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(summary.openInvoices.cents)}</div>
          <div className="text-xs text-slate-400">{summary.openInvoices.count} Rechnung(en)</div>
        </Link>
        <Link href="/rechnungen?status=due" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">Heute fällig</div>
          <div className="mt-1 text-xl font-semibold text-amber-700">{formatCents(summary.dueInvoices.cents)}</div>
          <div className="text-xs text-slate-400">{summary.dueInvoices.count} Rechnung(en)</div>
        </Link>
        <Link href="/rechnungen?status=overdue" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">Überfällig</div>
          <div className="mt-1 text-xl font-semibold text-rose-700">{formatCents(summary.overdueInvoices.cents)}</div>
          <div className="text-xs text-slate-400">{summary.overdueInvoices.count} Rechnung(en)</div>
        </Link>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Umsatz laufender Monat</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(summary.revenueThisMonthCents)}</div>
        </div>
        <Link href="/dokumente?status=SENT" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">Offene Angebote</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(summary.openQuotes.cents)}</div>
          <div className="text-xs text-slate-400">{summary.openQuotes.count} Angebot(e)</div>
        </Link>
        {/* Fix-Runde 1 (§45): drei zusaetzliche Kennzahlen. */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Fällig in 7 Tagen</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(summary.dueThisWeek.cents)}</div>
          <div className="text-xs text-slate-400">{summary.dueThisWeek.count} Rechnung(en)</div>
        </div>
        <Link href="/rechnungen?status=partial" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">Teilweise bezahlt</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(summary.partiallyPaid.cents)}</div>
          <div className="text-xs text-slate-400">{summary.partiallyPaid.count} Rechnung(en)</div>
        </Link>
        <Link href="/mahnwesen" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">Mahnung fällig</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{summary.dunningRequired.count}</div>
          <div className="text-xs text-slate-400">Rechnung(en)</div>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Überfällig nach Alter</h2>
          <AgingChart aging={summary.aging} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Letzte Belege</h2>
          <ul className="divide-y divide-slate-100">
            {summary.recentDocuments.map((d) => (
              <li key={`${d.kind}-${d.id}`} className="flex items-center justify-between py-2 text-sm">
                <a href={DOC_HREF[d.kind](d.id)} className="font-medium text-indigo-600 hover:underline">
                  {d.number ?? "Entwurf"}
                </a>
                <span className="text-slate-500">{d.customerName}</span>
                <span className="text-slate-400">{deDate(d.date)}</span>
                <StatusBadge status={d.status} />
              </li>
            ))}
            {summary.recentDocuments.length === 0 && <li className="py-6 text-center text-slate-400">Noch keine Belege.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
