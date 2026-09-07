/**
 * Zeitplan-Logik fuer die naechste Mahnstufe (Phase 6, Task 2) — rein/DB-frei, damit sie
 * ohne Datenbank getestet werden kann. `createDunning` (create.ts) laedt Rechnung/Stufen/
 * letzte Mahnung und ruft diese Funktion auf, um zu entscheiden, welche Stufe als Naechstes
 * dran ist und ob sie bereits faellig ist.
 */

export interface StageLike {
  order: number;
  enabled: boolean;
  daysAfterDue: number;
}

export interface DunningScheduleInput<S extends StageLike = StageLike> {
  /** Faelligkeit der zugrundeliegenden Rechnung. */
  invoiceDueDate: Date;
  /** Letzte bereits erstellte Mahnung dieser Rechnung, oder null, wenn noch keine existiert. */
  lastDunning: { order: number; dueDate: Date | null; sentAt: Date } | null;
  /** Alle konfigurierten Mahnstufen der Organisation (beliebige Reihenfolge). */
  stages: S[];
  /** Karenztage, die nur auf die erste Stufe (order 0) zusaetzlich draufgerechnet werden. */
  gracePeriodDays: number;
  now: Date;
}

export interface DunningSchedule<S extends StageLike = StageLike> {
  /** Naechste aktivierte Stufe nach der letzten Mahnung, oder null, wenn keine weitere existiert. */
  nextStage: S | null;
  /** Zeitpunkt, ab dem `nextStage` faellig wird (null, wenn es keine `nextStage` gibt). */
  dueAt: Date | null;
  /** `now` liegt taggenau (UTC-Datum) auf oder nach `dueAt`. */
  isDue: boolean;
  /** Ganze Tage seit der Rechnungsfaelligkeit bis `now` (Basis fuer den Verzugszins). */
  daysOverdue: number;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Nur das UTC-Kalenderdatum (ohne Uhrzeit) als Millisekunden-Zeitstempel — fuer den
 *  tagesgenauen Faelligkeitsvergleich (`isDue`), unabhaengig von der Uhrzeit von `now`. */
function utcDateOnly(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysBetweenDates(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export interface DunningLike {
  createdAt: Date;
  level: number;
  stage?: { order: number } | null;
}

/**
 * Nit (Fix-Welle): "letzte Mahnung" wurde an drei Stellen unterschiedlich bestimmt
 * (create.ts: createdAt desc + take 1; auto.ts: dieselbe DB-Query; die Rechnungsseite:
 * `orderBy level asc`, letztes Array-Element). Normalerweise identisch, aber nach einem
 * Reorder der Mahnstufen (S3 — order-Werte aendern sich rueckwirkend) NICHT mehr: die
 * Rechnungsseite haette dann die falsche Mahnung als "letzte" angezeigt. Ein Helper statt
 * drei divergierender Implementierungen — Tiebreak bei gleichem `createdAt` ueber die
 * Stufenordnung (`stage.order`, Fallback `level`), nicht ueber die Array-Position.
 */
export function latestDunning<T extends DunningLike>(dunnings: T[]): T | null {
  let best: T | null = null;
  for (const d of dunnings) {
    if (!best) {
      best = d;
      continue;
    }
    const dTime = d.createdAt.getTime();
    const bestTime = best.createdAt.getTime();
    if (dTime > bestTime) {
      best = d;
    } else if (dTime === bestTime) {
      const dOrder = d.stage?.order ?? d.level;
      const bestOrder = best.stage?.order ?? best.level;
      if (dOrder > bestOrder) best = d;
    }
  }
  return best;
}

/**
 * Ermittelt die naechste faellige Mahnstufe. `nextStage` = erste aktivierte Stufe mit
 * `order` groesser als die Stufe der letzten Mahnung (bzw. die erste ueberhaupt, wenn noch
 * keine Mahnung existiert); deaktivierte Stufen werden uebersprungen. Basis fuer `dueAt`
 * ist die Faelligkeit/der Versand der letzten Mahnung (bzw. die Rechnungsfaelligkeit, wenn
 * es die erste Mahnung ist) plus `nextStage.daysAfterDue` — die Karenzfrist
 * (`gracePeriodDays`) zaehlt dabei NUR bei der allerersten Stufe (order 0) zusaetzlich.
 */
export function dunningScheduleFor<S extends StageLike>(input: DunningScheduleInput<S>): DunningSchedule<S> {
  const afterOrder = input.lastDunning?.order ?? -1;
  const nextStage =
    input.stages
      .filter((s) => s.enabled && s.order > afterOrder)
      .sort((a, b) => a.order - b.order)[0] ?? null;

  const daysOverdue = daysBetweenDates(input.invoiceDueDate, input.now);

  if (!nextStage) {
    return { nextStage: null, dueAt: null, isDue: false, daysOverdue };
  }

  const base = input.lastDunning ? (input.lastDunning.dueDate ?? input.lastDunning.sentAt) : input.invoiceDueDate;
  const grace = nextStage.order === 0 ? input.gracePeriodDays : 0;
  const dueAt = addDays(base, nextStage.daysAfterDue + grace);
  const isDue = utcDateOnly(input.now) >= utcDateOnly(dueAt);

  return { nextStage, dueAt, isDue, daysOverdue };
}
