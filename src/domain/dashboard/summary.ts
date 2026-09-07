/**
 * Dashboard-Kennzahlen (Phase 8b, Task 4, `/` fuer angemeldete Nutzer). Rein lesend,
 * org-scoped, DB-portabel (Aggregation in JS ueber select-reduzierte Zeilen statt
 * DB-spezifischer Funktionen — Global Constraint).
 *
 * Fix-Runde 1 (Koordinator, §45): drei zusaetzliche Kennzahlen (dueThisWeek/
 * partiallyPaid/dunningRequired) sowie ein verallgemeinerter `agingBuckets`-Helfer
 * (N+1 Buckets statt fix vier), damit das Dashboard 5 Buckets (Grenzen 7/30/60/90,
 * Tag 0 eingeschlossen) zeigen kann, waehrend die Mahnuebersicht weiterhin ihre
 * bisherigen 4 Buckets (Grenzen 7/30/60, `daysOverdue >= 1`, §25) unveraendert liefert.
 *
 * Fix-Welle (S7): Tagesgrenzen in UTC (utcDateOnly, siehe src/lib/date-only.ts) statt
 * lokaler Zeit — einheitlich mit invoice/status.ts, invoice/list.ts, dunning/schedule.ts,
 * invoice/finalize.ts, notifications/job.ts.
 */
import { dbInternal } from "@/lib/db";
import { effectiveInvoiceStatus } from "@/domain/invoice/status";
import { openAmountCents, payableBaseCents } from "@/domain/invoice/amounts";
import { effectiveQuoteStatus } from "@/domain/document/status";
import { dunningCandidateWhere } from "@/domain/dunning/auto";
import { utcDateOnly, utcDateOnlyPlusDays } from "@/lib/date-only";

export interface AgingBucket {
  /** Deutsches Anzeigelabel, aus `bounds`/`minDays` abgeleitet (z. B. "8–30 Tage"). */
  label: string;
  count: number;
  cents: number;
}

export interface AgingBucketsOptions {
  /** Kleinste Tagesanzahl, die noch in einen Bucket faellt (Default 1 — "faellig heute",
   *  daysOverdue===0, zaehlt NICHT mit, §25). Das Dashboard uebergibt 0, um den heutigen
   *  Faelligkeitstag mit in den ersten Bucket aufzunehmen (§45). */
  minDays?: number;
}

/**
 * Verallgemeinerter Aging-Helfer (Fix-Runde 1, Koordinator): verteilt ueberfaellige
 * Zeilen (Faelligkeitsdatum + Betrag) auf `bounds.length + 1` Buckets — je Eintrag in
 * `bounds` ein Bucket mit oberer Tagesgrenze, plus ein abschliessender "> letzte Grenze"-
 * Bucket. `bounds` MUSS aufsteigend sortiert sein (z. B. `[7, 30, 60]` fuer die
 * Mahnuebersicht oder `[7, 30, 60, 90]` fuer das Dashboard). Labels werden aus den
 * Grenzen + `minDays` abgeleitet, keine hartkodierten Bucket-Schluessel mehr (ersetzt die
 * vorherige feste Vier-Schluessel-Form `{d1_7, d8_30, d31_60, d60plus}` — Aufrufer, die
 * diese Form nach aussen weiterreichen (z. B. `loadDunningOverview`), bauen sie lokal aus
 * dem Array wieder auf).
 */
export function agingBuckets(
  rows: { dueDate: Date; cents: number }[],
  now: Date = new Date(),
  bounds: number[] = [7, 30, 60],
  opts: AgingBucketsOptions = {},
): AgingBucket[] {
  const minDays = opts.minDays ?? 1;
  const buckets: AgingBucket[] = bounds.map((bound, i) => ({
    label: i === 0 ? `${minDays}–${bound} Tage` : `${bounds[i - 1] + 1}–${bound} Tage`,
    count: 0,
    cents: 0,
  }));
  buckets.push({ label: `> ${bounds[bounds.length - 1]} Tage`, count: 0, cents: 0 });

  const today = utcDateOnly(now);
  for (const row of rows) {
    const daysOverdue = Math.round((today - utcDateOnly(row.dueDate)) / (1000 * 60 * 60 * 24));
    if (daysOverdue < minDays) continue;
    let idx = bounds.findIndex((bound) => daysOverdue <= bound);
    if (idx === -1) idx = buckets.length - 1;
    buckets[idx].count += 1;
    buckets[idx].cents += row.cents;
  }
  return buckets;
}

export interface DashboardRecentDocument {
  kind: "INVOICE" | "QUOTE" | "DELIVERY_NOTE";
  id: string;
  number: string | null;
  customerName: string;
  date: Date;
  grossCents: number | null;
  status: string;
}

export interface DashboardSummary {
  openInvoices: { count: number; cents: number };
  dueInvoices: { count: number; cents: number };
  overdueInvoices: { count: number; cents: number };
  /** Fix-Runde 1 (§45): Rechnungen mit Faelligkeit in den naechsten 7 Tagen (heute
   *  eingeschlossen), unabhaengig vom effektiven Status — nur PAID/CANCELLED sind
   *  ausgenommen (Vorgabe: "nicht PAID/CANCELLED"). */
  dueThisWeek: { count: number; cents: number };
  /** Fix-Runde 1 (§45): Rechnungen mit Status PARTIALLY_PAID. */
  partiallyPaid: { count: number; cents: number };
  /** Fix-Runde 1 (§45): Anzahl mahnbarer, bereits faelliger Rechnungen — dieselbe
   *  Auswahl wie der automatische Mahnlauf (`dunningCandidates`, dunning/auto.ts). */
  dunningRequired: { count: number };
  revenueThisMonthCents: number;
  aging: AgingBucket[];
  recentDocuments: DashboardRecentDocument[];
  openQuotes: { count: number; cents: number };
}

/** Beginn des Kalendermonats (UTC) von `d`. */
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export async function dashboardSummary(orgId: string, now: Date = new Date()): Promise<DashboardSummary> {
  // Offene/faellige/ueberfaellige Rechnungen — nur FINALIZED/SENT/PARTIALLY_PAID koennen
  // effectiveInvoiceStatus OPEN/DUE/OVERDUE liefern (siehe status.ts).
  const openish = await dbInternal.invoice.findMany({
    where: { orgId, status: { in: ["FINALIZED", "SENT", "PARTIALLY_PAID"] } },
    select: { id: true, status: true, dueDate: true, issueDate: true, grossTotalCents: true, paidAmountCents: true, payableCents: true },
  });

  const openInvoices = { count: 0, cents: 0 };
  const dueInvoices = { count: 0, cents: 0 };
  const overdueInvoices = { count: 0, cents: 0 };
  const partiallyPaid = { count: 0, cents: 0 };
  // Aging (§45, Dashboard): Tag 0 ("faellig heute") zaehlt mit, deshalb DUE- UND
  // OVERDUE-Zeilen sammeln (nicht nur OVERDUE wie bei der Mahnuebersicht).
  const agingRows: { dueDate: Date; cents: number }[] = [];

  for (const inv of openish) {
    const status = effectiveInvoiceStatus({ status: inv.status, dueDate: inv.dueDate, issueDate: inv.issueDate }, now);
    const open = openAmountCents(inv);
    if (status === "OPEN") {
      openInvoices.count += 1;
      openInvoices.cents += open;
    } else if (status === "DUE") {
      dueInvoices.count += 1;
      dueInvoices.cents += open;
      agingRows.push({ dueDate: inv.dueDate ?? inv.issueDate, cents: open });
    } else if (status === "OVERDUE") {
      overdueInvoices.count += 1;
      overdueInvoices.cents += open;
      agingRows.push({ dueDate: inv.dueDate ?? inv.issueDate, cents: open });
    }
    if (inv.status === "PARTIALLY_PAID") {
      partiallyPaid.count += 1;
      partiallyPaid.cents += open;
    }
  }

  // Dashboard-Aging: Grenzen 7/30/60/90 (5 Buckets), Tag 0 eingeschlossen (minDays: 0) —
  // abweichend von der Mahnuebersicht (7/30/60, minDays: 1, §25).
  const aging = agingBuckets(agingRows, now, [7, 30, 60, 90], { minDays: 0 });

  // Faellig in den naechsten 7 Tagen (heute eingeschlossen), unabhaengig vom effektiven
  // Status — nur PAID/CANCELLED ausgenommen (§45). Eigene Query (breiter als `openish`,
  // schliesst z. B. DRAFT mit gesetztem Zahlungsziel ein).
  const today = new Date(utcDateOnly(now));
  const weekEnd = new Date(utcDateOnlyPlusDays(now, 8)); // exklusiv: +7 Tage inklusive
  const dueThisWeekRows = await dbInternal.invoice.findMany({
    where: { orgId, status: { notIn: ["PAID", "CANCELLED"] }, dueDate: { gte: today, lt: weekEnd } },
    select: { grossTotalCents: true, paidAmountCents: true, payableCents: true },
  });
  const dueThisWeek = { count: dueThisWeekRows.length, cents: dueThisWeekRows.reduce((sum, r) => sum + openAmountCents(r), 0) };

  // Mahnbare, bereits faellige Rechnungen — dieselbe Auswahl wie der automatische
  // Mahnlauf (dunning/auto.ts, geteilter Where-Builder dunningCandidateWhere, S5), aber
  // ohne die volle `dunnings`-Relation zu laden — nur die Anzahl wird gebraucht.
  const dunningRequired = { count: await dbInternal.invoice.count({ where: dunningCandidateWhere(orgId, now) }) };

  // Umsatz laufender Monat: Summe der Bemessungsgrundlage (payableBaseCents) festgeschriebener
  // Rechnungen (nicht DRAFT, nicht CANCELLED) mit issueDate im aktuellen Kalendermonat.
  // Fix-Welle (S2): vorher grossTotalCents per Prisma-Aggregat — bei einer Abschlagskette
  // (§14) zaehlt das den Abschlag doppelt (Abschlagsrechnung UND Schlussrechnung tragen
  // beide ihren vollen Brutto-Betrag; die Schlussrechnung reduziert nur `payableCents`,
  // nicht `grossTotalCents`). payableBaseCents (payableCents ?? grossTotalCents) ist die
  // korrekte Bemessungsgrundlage — kein DB-Aggregat mehr moeglich, daher `select`-reduzierte
  // Zeilen + JS-Summe (portabel, siehe Modul-Kommentar).
  const revenueRows = await dbInternal.invoice.findMany({
    where: {
      orgId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      issueDate: { gte: startOfMonth(now), lt: startOfNextMonth(now) },
    },
    select: { grossTotalCents: true, payableCents: true },
  });
  const revenueThisMonthCents = revenueRows.reduce((sum, r) => sum + payableBaseCents(r), 0);

  // Offene Angebote: NUR SENT (noch nicht abgelaufen) — Fix-Welle (Nit): die Kachel
  // verlinkt auf /dokumente?status=SENT, zaehlte aber vorher zusaetzlich DRAFT mit, was
  // Kachel-Zahl und Ziel-Liste auseinanderlaufen liess (Ruling: Kachel zaehlt nur SENT).
  const quotes = await dbInternal.quote.findMany({
    where: { orgId, status: "SENT" },
    select: { status: true, validUntil: true, grossTotalCents: true },
  });
  const openQuotes = { count: 0, cents: 0 };
  for (const q of quotes) {
    const status = effectiveQuoteStatus({ status: q.status, validUntil: q.validUntil }, now);
    if (status === "SENT") {
      openQuotes.count += 1;
      openQuotes.cents += q.grossTotalCents;
    }
  }

  // Letzte 5 Belege (Rechnung/Angebot/Lieferschein) ueber alle drei Tabellen, gemischt
  // nach Datum sortiert — je Tabelle die letzten 5 laden (billig) und danach in JS
  // mischen/kuerzen, statt einer DB-spezifischen UNION-Query (Global Constraint).
  const [recentInvoices, recentQuotes, recentDeliveryNotes] = await Promise.all([
    dbInternal.invoice.findMany({
      where: { orgId },
      orderBy: { issueDate: "desc" },
      take: 5,
      select: { id: true, number: true, status: true, issueDate: true, grossTotalCents: true, customer: { select: { name: true } } },
    }),
    dbInternal.quote.findMany({
      where: { orgId },
      orderBy: { issueDate: "desc" },
      take: 5,
      select: { id: true, number: true, status: true, issueDate: true, grossTotalCents: true, customer: { select: { name: true } } },
    }),
    dbInternal.deliveryNote.findMany({
      where: { orgId },
      orderBy: { issueDate: "desc" },
      take: 5,
      select: { id: true, number: true, status: true, issueDate: true, customer: { select: { name: true } } },
    }),
  ]);

  const recentDocuments: DashboardRecentDocument[] = [
    ...recentInvoices.map((r) => ({
      kind: "INVOICE" as const,
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      date: r.issueDate,
      grossCents: r.grossTotalCents,
      status: r.status,
    })),
    ...recentQuotes.map((r) => ({
      kind: "QUOTE" as const,
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      date: r.issueDate,
      grossCents: r.grossTotalCents,
      status: r.status,
    })),
    ...recentDeliveryNotes.map((r) => ({
      kind: "DELIVERY_NOTE" as const,
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      date: r.issueDate,
      grossCents: null,
      status: r.status,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);

  return {
    openInvoices,
    dueInvoices,
    overdueInvoices,
    dueThisWeek,
    partiallyPaid,
    dunningRequired,
    revenueThisMonthCents,
    aging,
    recentDocuments,
    openQuotes,
  };
}
