/**
 * Fix-Welle Phase 8b (final-review-findings.md S7): einheitliche Tagesgrenzen-Konvention.
 * Die bestehende Codebasis (dunning/schedule.ts, invoice/finalize.ts, lib/pricing/skonto.ts,
 * notifications/job.ts) vergleicht Kalendertage ausschliesslich in UTC — die neuen Phase-8b-
 * Module (invoice/status.ts, invoice/list.ts, dashboard/summary.ts, dunning/overview.ts)
 * verglichen stattdessen in lokaler Zeit. Mit `TZ=Europe/Berlin` im Container ergibt das ein
 * ca. zweistuendiges Fenster pro Nacht, in dem Listen-/Dashboard-Badges bereits "Überfällig"
 * zeigen, waehrend der Mahnlauf/die Benachrichtigung noch "nicht faellig" sagen. Diese
 * Funktion ist jetzt die einzige Quelle der Wahrheit fuer "Kalendertag von X, tagesgenau,
 * UTC" — alle vier neuen Module nutzen sie statt eigener lokaler `startOfDay`-Helfer.
 */
export function utcDateOnly(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `utcDateOnly` plus `days` Tage (in Millisekunden-Zeitstempel, kompatibel mit `utcDateOnly`). */
export function utcDateOnlyPlusDays(d: Date, days: number): number {
  return utcDateOnly(d) + days * 24 * 60 * 60 * 1000;
}
