/**
 * Dynamischer Rechnungsstatus (Phase 8b, §39). "fällig"/"überfällig" wird NIE
 * gespeichert (Global Constraint des Plans) — er ergibt sich ausschließlich aus
 * `status` + `dueDate` zum Anzeigezeitpunkt. Analog zu `effectiveQuoteStatus`
 * (src/domain/document/status.ts): reine Funktion, tagesgenauer Vergleich in UTC
 * (Fix-Welle S7 — einheitliche Konvention mit dunning/schedule.ts, invoice/finalize.ts,
 * lib/pricing/skonto.ts, notifications/job.ts; siehe src/lib/date-only.ts).
 *
 * FINALIZED/SENT/PARTIALLY_PAID verzweigen in OPEN/DUE/OVERDUE — DRAFT/PAID/CANCELLED
 * sind für den Fälligkeits-Status irrelevant und werden 1:1 durchgereicht.
 *
 * Fix-Welle (S1, Ruling): eine teilbezahlte Rechnung ist weiterhin faellig/ueberfaellig,
 * solange ein Restbetrag offen ist — vor der Fix-Welle lieferte diese Funktion fuer
 * PARTIALLY_PAID immer den Rohstatus zurueck, wodurch teilbezahlte ueberfaellige
 * Rechnungen aus jeder faellig/ueberfaellig-Ableitung verschwanden (Kundenuebersicht,
 * Dashboard-Aging, Listenfilter "overdue", Mahn-Aktionsmatrix). PARTIALLY_PAID faellt
 * jetzt in den dueDate-Zweig; `isPartiallyPaid` liefert das zusaetzliche Flag fuer
 * Aufrufer, die den Teilzahlungs-Hinweis separat anzeigen wollen (z. B. StatusBadge
 * "Überfällig · teilbezahlt").
 */
import { utcDateOnly } from "@/lib/date-only";

export type EffectiveInvoiceStatus =
  | "DRAFT"
  | "FINALIZED"
  | "OPEN"
  | "DUE"
  | "OVERDUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CANCELLED";

export const INVOICE_STATUS_LABEL: Record<EffectiveInvoiceStatus, string> = {
  DRAFT: "Entwurf",
  FINALIZED: "Festgeschrieben",
  OPEN: "Offen",
  DUE: "Fällig heute",
  OVERDUE: "Überfällig",
  PARTIALLY_PAID: "Teilweise bezahlt",
  PAID: "Bezahlt",
  CANCELLED: "Storniert",
};

export interface EffectiveInvoiceStatusInput {
  /** Rohstatus aus Invoice.status: DRAFT | FINALIZED | SENT | PAID | PARTIALLY_PAID | CANCELLED. */
  status: string;
  dueDate: Date | null;
  /** Aktuell nicht Teil der Berechnung (fälliger Vergleich läuft ausschließlich über dueDate),
   *  aber Teil der Signatur, damit Aufrufer stets denselben Belegausschnitt reichen wie bei
   *  effectiveQuoteStatus und künftige Regeln (z. B. Skonto-Fristen) ansetzen können. */
  issueDate: Date;
}

/**
 * Leitet den tatsächlich wirksamen Rechnungsstatus ab. FINALIZED/SENT/PARTIALLY_PAID
 * ohne `dueDate` gelten als OPEN (kein Zahlungsziel gesetzt, also nichts, dem gegenüber
 * "fällig"/"überfällig" sinnvoll wäre).
 */
export function effectiveInvoiceStatus(
  inv: EffectiveInvoiceStatusInput,
  now: Date = new Date(),
): EffectiveInvoiceStatus {
  const status = inv.status;

  if (status === "DRAFT" || status === "PAID" || status === "CANCELLED") {
    return status;
  }

  // status ist FINALIZED, SENT oder PARTIALLY_PAID (jeder andere/unbekannte Rohstatus
  // faellt hier ebenfalls durch — bewusst kein throw, reine Anzeige-Funktion). Eine
  // teilbezahlte Rechnung mit Restbetrag ist weiterhin faellig/ueberfaellig (S1) —
  // `isPartiallyPaid` liefert das zusaetzliche Flag fuer Aufrufer, die das separat
  // anzeigen wollen.
  if (!inv.dueDate) return "OPEN";

  const today = utcDateOnly(now);
  const due = utcDateOnly(inv.dueDate);

  if (due < today) return "OVERDUE";
  if (due === today) return "DUE";
  return "OPEN";
}

/** True, wenn die Rechnung (Rohstatus) teilweise bezahlt ist — unabhaengig vom
 *  faelligkeits-Status, den `effectiveInvoiceStatus` fuer sie liefert (S1). */
export function isPartiallyPaid(status: string): boolean {
  return status === "PARTIALLY_PAID";
}
