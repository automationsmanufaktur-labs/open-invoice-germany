/**
 * Wiederkehrende Rechnungen — reine Termin-Logik (ohne DB), damit testbar.
 *
 * `advanceDate` schiebt einen Stichtag um ein Intervall weiter. Monatsbasierte
 * Intervalle klemmen den Tag an den Monatsletzten (31.01. + 1 Monat → 28./29.02.),
 * damit nie ein ungültiges Datum entsteht. Optional fixiert `anchorDay` den Tag
 * (z. B. immer der 1.). Gerechnet wird in lokaler Zeit — konsistent mit der
 * Belegnummern-Logik (src/domain/numbering.ts).
 */

export type RecurInterval = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

const MONTHS_PER: Record<RecurInterval, number> = {
  WEEKLY: 0,
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

export const INTERVAL_LABEL: Record<RecurInterval, string> = {
  WEEKLY: "wöchentlich",
  MONTHLY: "monatlich",
  QUARTERLY: "vierteljährlich",
  YEARLY: "jährlich",
};

export function intervalLabel(interval: string, count = 1): string {
  const base = INTERVAL_LABEL[interval as RecurInterval] ?? interval;
  if (count <= 1) return base;
  const unit: Record<RecurInterval, string> = {
    WEEKLY: "Wochen",
    MONTHLY: "Monate",
    QUARTERLY: "Quartale",
    YEARLY: "Jahre",
  };
  return `alle ${count} ${unit[interval as RecurInterval] ?? interval}`;
}

/**
 * Normalisiert ein Datum auf 12:00 Uhr lokal seines Kalendertags. Stichtage liegen
 * dadurch nie nahe der Mitternachtsgrenze — so driftet die Tagesanzeige weder über
 * Zeitzonen noch über Sommer-/Winterzeit (toISOString und lokale Formatierung
 * zeigen denselben Kalendertag).
 */
export function normalizeToNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

export function advanceDate(from: Date, interval: RecurInterval, count = 1, anchorDay?: number | null): Date {
  if (interval === "WEEKLY") {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7 * count, 12, 0, 0, 0);
  }
  const months = MONTHS_PER[interval] * count;
  const totalMonth = from.getMonth() + months;
  const targetYear = from.getFullYear() + Math.floor(totalMonth / 12);
  const targetMonth = ((totalMonth % 12) + 12) % 12;
  const desiredDay = anchorDay ?? from.getDate();
  const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(desiredDay, lastDayOfMonth);
  return new Date(targetYear, targetMonth, day, 12, 0, 0, 0);
}
