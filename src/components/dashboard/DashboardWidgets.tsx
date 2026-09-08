import Link from "next/link";
import type { DashboardSummary } from "@/domain/dashboard/summary";
import type { MonthlyRevenuePoint } from "@/domain/reporting/revenue";
import type { StatusCount } from "@/domain/reporting/status";
import type { TopCustomer } from "@/domain/reporting/customers";
import { formatCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { AgingChart } from "@/components/dashboard/AgingChart";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { revenueChartData, statusDonutData, topCustomerChartData } from "@/components/dashboard/chart-data";

function deDate(d: Date) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(d);
}

const DOC_HREF: Record<string, (id: string) => string> = {
  INVOICE: (id) => `/rechnungen/${id}`,
  QUOTE: (id) => `/dokumente/${id}`,
  DELIVERY_NOTE: (id) => `/lieferscheine/${id}`,
};

/**
 * Dashboard-Widgets (Task 4, `/`) — Kennzahlkacheln, Umsatzreihe, Statusring, Top-5-Kunden,
 * Aging und letzte Belege. `revenue`/`statuses`/`top` kommen aus src/domain/reporting/* —
 * dieselbe Aufteilung wie `summary` (dashboardSummary bleibt fuer die Kennzahlkacheln
 * zustaendig, kein Doppelbau, §1.4).
 *
 * Fix I5 (Abschluss-Review): `items-start` statt des Grid-Defaults `items-stretch` — die
 * vier Karten im unteren Raster haben unterschiedlich viel Inhalt (Donut ~240 px, Aging/
 * Top-5 je nach Zeilenzahl, "Letzte Belege" bis zu 5 Zeilen); vorher streckte das Grid jede
 * Karte auf die Hoehe der hoechsten, wodurch der Donut auf voller Spaltenbreite (~430 px)
 * rendern konnte und seine Mittelzahl effektiv ~50 px gross wurde. `min-h-*` je Karte haelt
 * das Layout trotzdem stabil (kein Sprung zwischen leerem und gefuelltem Zustand). Die
 * Donut-Karte bekommt zusaetzlich `max-w-[220px] mx-auto`, damit das SVG (`w-full`) nicht
 * ueber seine native 240er-viewBox hinaus gestreckt wird. Aging/Top-5 (`BarChart`,
 * waagerecht) bekommen `viewBoxWidth={320}` (Fix I6) — die halbe Spaltenbreite entspricht
 * ungefaehr dieser Koordinatenbreite, wodurch `fontSize`-Angaben dort nahe an ihrer
 * nominalen Pixelgroesse rendern statt auf ~7 px herunterskaliert zu werden.
 *
 * Fix I6 (Nachtrag, Screenshot-Review bei 400 px): die Umsatzreihe ganz oben ist IMMER
 * volle Kartenbreite (kein halbes Grid) — bei ~1100 px (Desktop) passt `viewBoxWidth`
 * 640 gut, bei ~370 px (Mobile, Karte unterhalb `sm`) skaliert dieselbe viewBox die Schrift
 * auf ~7 px herunter. Da SVG `font-size` (Attribut UND CSS) IMMER im lokalen, durch
 * `viewBox` skalierten Koordinatensystem gilt (keine per-Breakpoint-Ausnahme, empirisch
 * geprueft), gibt es dafuer ohne Client-JS nur einen Ausweg: zwei serverseitig gerenderte
 * Varianten, per `hidden`/`sm:hidden` (reines CSS) umgeschaltet — die unterhalb `sm`
 * ausgeblendete Variante ist ueber `display:none` bereits vollstaendig aus dem
 * Accessibility-Baum entfernt (keine doppelte sr-only-Tabelle fuer Screenreader).
 */
export function DashboardWidgets({
  summary,
  revenue,
  statuses,
  top,
}: {
  summary: DashboardSummary;
  revenue: MonthlyRevenuePoint[];
  statuses: StatusCount[];
  top: TopCustomer[];
}) {
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
          <div className="text-xs uppercase tracking-wide text-slate-500">Nettoumsatz (laufender Monat)</div>
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

      <div className="hidden min-h-[280px] rounded-lg border border-slate-200 bg-white p-5 sm:block">
        <BarChart
          title="Umsatz je Monat (netto, 12 Monate)"
          data={revenueChartData(revenue)}
          emptyMessage="Noch keine Umsätze im Zeitraum."
        />
      </div>
      <div className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-5 sm:hidden">
        <BarChart
          title="Umsatz je Monat (netto, 12 Monate)"
          data={revenueChartData(revenue)}
          emptyMessage="Noch keine Umsätze im Zeitraum."
          viewBoxWidth={340}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-5">
          <AgingChart aging={summary.aging} viewBoxWidth={320} />
        </div>

        <div className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-5">
          <div className="mx-auto max-w-[220px]">
            <DonutChart title="Rechnungsstatus (Anzahl)" data={statusDonutData(statuses)} />
          </div>
        </div>

        <div className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-5">
          <BarChart title="Top 5 Kunden (netto, 12 Monate)" data={topCustomerChartData(top)} orientation="horizontal" viewBoxWidth={320} />
        </div>

        <div className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Letzte Belege</h2>
          <ul className="divide-y divide-slate-100">
            {summary.recentDocuments.map((d) => (
              /* Fix M2 (Minor, nicht von 12e verursacht — Vorbefund aus Task 4/Phase 8b):
                 flex-wrap + min-w-0/truncate auf der Kundenspalte, sonst brechen lange
                 Belegnummern/Kundennamen bei 400 px Viewport auf zwei Zeilen und
                 ueberlappen Datum/Badge. */
              <li key={`${d.kind}-${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <a href={DOC_HREF[d.kind](d.id)} className="font-medium text-indigo-600 hover:underline">
                  {d.number ?? "Entwurf"}
                </a>
                <span className="min-w-0 flex-1 truncate text-slate-500">{d.customerName}</span>
                <span className="shrink-0 text-slate-400">{deDate(d.date)}</span>
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
