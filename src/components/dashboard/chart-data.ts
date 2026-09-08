/**
 * Aufbereitung der Diagrammdaten (Phase 12e, Task 4). Reine Funktionen ohne DB-Zugriff —
 * wandeln die Rueckgaben der Reporting-Domain (src/domain/reporting/*) und des
 * bestehenden Dashboard-Summarys (src/domain/dashboard/summary.ts) in `ChartDatum[]` fuer
 * den Baukasten (src/components/charts) um. Getrennt von den Widget-Komponenten, damit sie
 * ohne React-Rendering getestet werden koennen (test/unit/dashboard-charts.test.tsx).
 */
import type { ChartDatum } from "@/components/charts/types";
import { CHART_COLORS } from "@/components/charts/types";
import type { MonthlyRevenuePoint } from "@/domain/reporting/revenue";
import type { TopCustomer } from "@/domain/reporting/customers";
import type { StatusCount } from "@/domain/reporting/status";
import type { AgingBucket } from "@/domain/dashboard/summary";
import { formatCents } from "@/lib/money";

/**
 * "2086-01" -> "Jan 86" (de-DE, UTC). `Intl` liefert fuer abgekuerzte Monate einen Punkt
 * ("Jan. 86") — der wird entfernt, damit die Achsenbeschriftung kompakt bleibt (deckt sich
 * mit den Testdaten in test/unit/charts.test.tsx, die bereits ohne Punkt geschrieben sind).
 */
function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(d)
    .replace(/\./g, "");
}

/**
 * Umsatzreihe (`monthlyRevenue`) als Balken — negative Monate (Gutschrift-Ueberhang) bleiben
 * negativ.
 *
 * Fix M1 (Abschluss-Review): `monthlyRevenue` fuellt IMMER alle Monats-Buckets (auch ohne
 * Beleg als 0-Eintrag, siehe dortiger Modulkommentar) — `ChartFrame`s Leerzustand
 * (`data.length === 0`) trat dadurch nie ein; ein frisch angelegter Kunde/eine frische Org
 * bekam stattdessen eine nichtssagende Nulllinie direkt auf der unteren Kante. Liefert jetzt
 * `[]`, wenn KEIN Bucket einen Beleg traegt (`count === 0`), damit `BarChart`/`LineChart`
 * ueber ihr `emptyMessage`-Prop den Leerzustand zeigen statt der Nulllinie.
 */
export function revenueChartData(points: MonthlyRevenuePoint[]): ChartDatum[] {
  if (points.every((p) => p.count === 0)) return [];
  return points.map((p) => ({
    label: monthLabel(p.month),
    value: p.netCents,
    valueLabel: formatCents(p.netCents),
  }));
}

type StatusDonutSegment = { label: string; color: string; statuses: StatusCount["status"][] };

/** Drei feste Segmente fuers Ringdiagramm — PARTIALLY_PAID zaehlt zu "Offen", nicht zu "Bezahlt". */
const STATUS_DONUT_SEGMENTS: StatusDonutSegment[] = [
  { label: "Offen", color: CHART_COLORS.primary, statuses: ["OPEN", "DUE", "PARTIALLY_PAID"] },
  { label: "Überfällig", color: CHART_COLORS.overdue, statuses: ["OVERDUE"] },
  { label: "Bezahlt", color: CHART_COLORS.second, statuses: ["PAID"] },
];

/**
 * Buendelt `statusCounts` zu Offen/Ueberfaellig/Bezahlt. Segmente mit `value === 0` bleiben
 * in der Liste (Legende vollstaendig), der Donut selbst ignoriert sie geometrisch.
 */
export function statusDonutData(rows: StatusCount[]): ChartDatum[] {
  return STATUS_DONUT_SEGMENTS.map((segment) => {
    const count = rows.filter((r) => segment.statuses.includes(r.status)).reduce((sum, r) => sum + r.count, 0);
    return {
      label: segment.label,
      value: count,
      valueLabel: `${count} Rechnung${count === 1 ? "" : "en"}`,
      color: segment.color,
    };
  });
}

/** Kuerzt einen Kundennamen auf `max` Zeichen (inkl. Ellipse) fuer die Diagrammachse. */
function truncateName(name: string, max = 24): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

/** `topCustomers` als waagerechte Balken — Reihenfolge (nach Umsatz sortiert) bleibt erhalten. */
export function topCustomerChartData(rows: TopCustomer[]): ChartDatum[] {
  return rows.map((r) => ({
    label: truncateName(r.name),
    value: r.netCents,
    valueLabel: formatCents(r.netCents),
  }));
}

/** Aging-Buckets (src/domain/dashboard/summary.ts) als waagerechte Balken. */
export function agingChartData(buckets: AgingBucket[]): ChartDatum[] {
  return buckets.map((b) => ({
    label: b.label,
    value: b.cents,
    valueLabel: `${formatCents(b.cents)} (${b.count})`,
    color: CHART_COLORS.due,
  }));
}
