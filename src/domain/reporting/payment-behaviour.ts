/**
 * Zahlungsverhalten fuer Auswertungen/Grafiken (Phase 12e, Task 3, §54). Rein lesend,
 * org-scoped (optional zusaetzlich auf einen Kunden eingeschraenkt), reine Funktion ueber
 * select-reduzierte Zeilen. Tagesgrenzen tagesgenau in UTC (utcDateOnly, siehe
 * src/lib/date-only.ts) — einheitlich mit invoice/status.ts, dashboard/summary.ts.
 *
 * Ruling (kein Doppelbau, §1.4): liefert bewusst KEIN `openCents` — den kennt
 * `customerOverview().kpis.openCents` bzw. `dashboardSummary().openInvoices.cents`
 * bereits. Die Kundenseite bezieht den offenen Betrag weiterhin aus `customerOverview`.
 */
import { dbInternal } from "@/lib/db";
import { utcDateOnly } from "@/lib/date-only";
import { roundHalfUp } from "@/lib/money";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaymentBehaviour {
  /** Mittelwert der Tage zwischen Rechnungsdatum und letzter Zahlung; null ohne bezahlte Rechnung. */
  avgDaysToPay: number | null;
  /** Anteil der bis zum Faelligkeitstag bezahlten Rechnungen (0..1); null ohne Faelligkeitsdatum. */
  onTimeShare: number | null;
  paidCount: number;
}

/**
 * Mittelt ueber alle als PAID abgeschlossenen Rechnungen der Organisation (optional
 * gefiltert auf einen Kunden) die Tage zwischen Rechnungsdatum und der spaetesten
 * erfassten Zahlung sowie den Anteil, der bis zum Faelligkeitstag beglichen wurde
 * ("am Faelligkeitstag" zaehlt als puenktlich). Rechnungen ohne Zahlungszeile (z. B. per
 * manuellem Statuswechsel auf PAID gesetzt, ohne `recordPayment`) werden uebersprungen
 * und zaehlen nicht in `paidCount` — es gibt keinen Zahlungszeitpunkt, ueber den gemittelt
 * werden koennte.
 */
export async function paymentBehaviour(orgId: string, opts: { customerId?: string } = {}): Promise<PaymentBehaviour> {
  const invoices = await dbInternal.invoice.findMany({
    where: { orgId, status: "PAID", ...(opts.customerId ? { customerId: opts.customerId } : {}) },
    select: { id: true, issueDate: true, dueDate: true, payments: { select: { paidAt: true }, orderBy: { paidAt: "desc" }, take: 1 } },
  });

  let paidCount = 0;
  let sumDays = 0;
  let withDueDate = 0;
  let onTimeCount = 0;

  for (const inv of invoices) {
    const settledAt = inv.payments[0]?.paidAt;
    if (!settledAt) continue; // keine Zahlungszeile -> kein Zahlungszeitpunkt, wird uebersprungen

    paidCount += 1;
    sumDays += (utcDateOnly(settledAt) - utcDateOnly(inv.issueDate)) / DAY_MS;

    if (inv.dueDate) {
      withDueDate += 1;
      if (utcDateOnly(settledAt) <= utcDateOnly(inv.dueDate)) onTimeCount += 1;
    }
  }

  return {
    avgDaysToPay: paidCount === 0 ? null : roundHalfUp(sumDays / paidCount),
    onTimeShare: withDueDate === 0 ? null : onTimeCount / withDueDate,
    paidCount,
  };
}
