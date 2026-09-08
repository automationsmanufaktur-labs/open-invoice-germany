import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { customerOverview } from "@/domain/customer/overview";
import { NotFoundError } from "@/domain/errors";
import { monthlyRevenue } from "@/domain/reporting/revenue";
import { paymentBehaviour } from "@/domain/reporting/payment-behaviour";
import { CustomerTabs } from "@/components/customers/CustomerTabs";
import { StatusBadge } from "@/components/StatusBadge";
import { LineChart } from "@/components/charts/LineChart";
import { revenueChartData } from "@/components/dashboard/chart-data";
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

  const [revenue, behaviour] = await Promise.all([
    monthlyRevenue(org.id, { customerId: id }),
    paymentBehaviour(org.id, { customerId: id }),
  ]);

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

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Offener Betrag</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(kpis.openCents)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Davon überfällig</div>
          <div className={`mt-1 text-xl font-semibold ${kpis.overdueCents > 0 ? "text-rose-700" : "text-slate-900"}`}>{formatCents(kpis.overdueCents)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Nettoumsatz</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{formatCents(kpis.totalRevenueCents)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Ø Zahlungsdauer</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">
            {behaviour.avgDaysToPay === null ? "—" : `${behaviour.avgDaysToPay} Tage`}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Pünktlich bezahlt</div>
          <div
            className={`mt-1 text-xl font-semibold ${
              behaviour.onTimeShare === null
                ? "text-slate-900"
                : behaviour.onTimeShare >= 0.8
                  ? "text-emerald-700"
                  : "text-amber-700"
            }`}
          >
            {behaviour.onTimeShare === null ? "—" : `${Math.round(behaviour.onTimeShare * 100)} %`}
          </div>
          {/* Fix M12 (Abschluss-Review): null neutral statt amber (sah wie ein schlechter Wert
              aus) + Stichprobengroesse als Unterzeile — "100 %" aus einer einzigen bezahlten
              Rechnung ist sonst nicht von "100 % aus 50 Rechnungen" zu unterscheiden. */}
          <div className="text-xs text-slate-400">
            {behaviour.paidCount === 0 ? "keine bezahlten Rechnungen" : `${behaviour.paidCount} bezahlte Rechnung(en)`}
          </div>
        </div>
      </div>

      {/* Fix I6 (Nachtrag, Screenshot-Review): zwei Varianten wie beim Dashboard-Balken —
          volle viewBoxWidth (640) ab `sm`, reduziert (340) darunter (siehe
          DashboardWidgets.tsx fuer die vollstaendige Begruendung: SVG font-size laesst
          sich ohne Client-JS nicht per Breakpoint responsiv machen). */}
      <div className="hidden rounded-lg border border-slate-200 bg-white p-5 sm:block">
        <LineChart
          title="Umsatz je Monat (netto, 12 Monate)"
          data={revenueChartData(revenue)}
          emptyMessage="Noch keine Umsätze im Zeitraum."
        />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 sm:hidden">
        <LineChart
          title="Umsatz je Monat (netto, 12 Monate)"
          data={revenueChartData(revenue)}
          emptyMessage="Noch keine Umsätze im Zeitraum."
          viewBoxWidth={340}
        />
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
