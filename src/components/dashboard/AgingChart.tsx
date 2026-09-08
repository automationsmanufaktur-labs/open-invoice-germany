import type { AgingBucket } from "@/domain/dashboard/summary";
import { BarChart } from "@/components/charts/BarChart";
import { agingChartData } from "@/components/dashboard/chart-data";

/**
 * Aging-Buckets ueberfaelliger Rechnungen (Phase 12e, Task 4: migriert auf den
 * Inline-SVG-Baukasten, Datei und Exportname bleiben — DashboardWidgets bindet weiterhin
 * `<AgingChart aging={summary.aging} />` unveraendert ein). Die Titel-Ueberschrift kommt
 * jetzt aus `ChartFrame` (figcaption), nicht mehr aus einer eigenen `<h2>` im Aufrufer.
 *
 * Fix I3 (Abschluss-Review): Titel nennt jetzt explizit die Bemessungsgrundlage — dieses
 * Diagramm zeigt (anders als die Umsatzreihe/-diagramme, netto/accrual) den OFFENEN
 * BRUTTObetrag (`AgingBucket.cents` = `openAmountCents`, dashboard/summary.ts), damit auf
 * demselben Bildschirm nicht zwei unterschiedliche, aber gleich aussehende Bemessungs-
 * grundlagen nebeneinanderstehen, ohne dass es aus dem Titel hervorgeht.
 *
 * Fix I6 (Abschluss-Review): `viewBoxWidth` durchgereicht an `BarChart` — DashboardWidgets
 * uebergibt fuer die halbe Dashboard-Kartenbreite einen kleineren Wert.
 */
export function AgingChart({ aging, viewBoxWidth }: { aging: AgingBucket[]; viewBoxWidth?: number }) {
  return (
    <BarChart
      title="Überfällig nach Alter (offen, brutto)"
      data={agingChartData(aging)}
      orientation="horizontal"
      viewBoxWidth={viewBoxWidth}
    />
  );
}
