/**
 * Skonto-Fristen, -Beträge und -Erkennung sowie BT-20-Freitext-Syntax
 * (XRechnung "Zahlungsbedingungen", z. B. genutzt von ZUGFeRD/E-Rechnungs-
 * Software wie ZUGFeRD-Community-Skripten oder "sepa-skonto-tags").
 *
 * Alle Datumsvergleiche laufen in UTC auf Tagesende: `dueDate = issueDate +
 * days` (Kalendertage), ein Zahlungseingang zählt noch, wenn
 * `paidAt <= endOfDay(dueDate)`.
 */
import { formatCents, roundHalfUp } from "../money";

export interface SkontoTerm {
  /** Skonto-Satz in Promille (0..1000 = 0..100 %). */
  permille: number;
  /** Frist in Kalendertagen ab Rechnungsdatum. */
  days: number;
  /** Fällig bis (Kalendertag, UTC). */
  dueDate: Date;
  /** Skontobetrag in Cent. */
  amountCents: number;
  /** Zu zahlender Betrag bei Skontoabzug (grossTotalCents - amountCents). */
  payableCents: number;
}

export interface SkontoTermsInput {
  issueDate: Date;
  grossTotalCents: number;
  skonto1Permille: number | null;
  skonto1Days: number | null;
  skonto2Permille: number | null;
  skonto2Days: number | null;
}

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const base = toUtcMidnight(d);
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

// Fristende = UTC-Tagesende (bewusste Konvention, siehe Modulkommentar oben). In der
// deutschen Zeitzone (Berlin, UTC+1/+2) bedeutet das: die Frist laeuft praktisch bis
// 01:00 bzw. 02:00 Uhr NACHTS des Folgetags weiter, weil UTC-Mitternacht des Folgetags
// erst dann erreicht ist. Ein Zahlungseingang in diesen fruehen Morgenstunden zaehlt
// also noch fristgerecht — bewusst grosszuegig statt eine serverlokale Zeitzone
// mitzufuehren (die bei DST-Umstellungen ohnehin uneindeutig waere).
function endOfUtcDay(d: Date): Date {
  const base = toUtcMidnight(d);
  return new Date(base.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function formatDateDE(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

/** Prozent mit maximal 2 Nachkommastellen, ohne überflüssige Nullen (Menschentext). */
function formatPercentDE(permille: number): string {
  const value = permille / 10;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value)} %`;
}

/** Prozent mit genau 2 Nachkommastellen und Punkt (BT-20-Syntax). */
function formatPercentBt20(permille: number): string {
  return (permille / 10).toFixed(2);
}

/** Baut die (bis zu zwei) Skonto-Fristen aus den Konditionen eines Belegs. */
export function skontoTerms(i: SkontoTermsInput): SkontoTerm[] {
  const terms: SkontoTerm[] = [];

  const add = (permille: number | null, days: number | null): void => {
    if (permille == null || days == null) return;
    if (permille <= 0 || days <= 0) return;
    const dueDate = addUtcDays(i.issueDate, days);
    const amountCents = roundHalfUp((i.grossTotalCents * permille) / 1000);
    const payableCents = i.grossTotalCents - amountCents;
    terms.push({ permille, days, dueDate, amountCents, payableCents });
  };

  add(i.skonto1Permille, i.skonto1Days);
  add(i.skonto2Permille, i.skonto2Days);

  return terms;
}

/**
 * Ermittelt die zutreffende Skonto-Frist für einen Zahlungseingang.
 *
 * Fix-Welle (G-detectSkonto): die alte Regel `amountCents >= payableCents - 1` traf
 * auf JEDE Zahlung zwischen Skonto-Zahlbetrag und offenem Betrag zu — z. B. wurde
 * eine Zahlung von 999,99 € auf eine Forderung von 1.000,00 € faelschlich als
 * "2 % Skonto genommen" erkannt, obwohl nur 1 Cent fehlte. Jetzt muss der gezahlte
 * Betrag INNERHALB ±1 Cent zum Skonto-Zahlbetrag (`payableCents`) liegen — bei
 * mehreren Treffern gewinnt der naechstliegende. Zusaetzlich muss der tatsaechlich
 * gewaehrte Rest (offener Betrag vor der Zahlung minus gezahlter Betrag) ±1 Cent zum
 * Skontobetrag des Terms (`amountCents`) passen, sonst gibt es KEINEN Vorschlag —
 * das faengt Teilzahlungen ab, bei denen `openBeforeCents` vom vollen Rechnungsbetrag
 * abweicht (z. B. durch eine vorherige Anzahlung).
 */
export function detectSkonto(
  terms: readonly SkontoTerm[],
  paidAt: Date,
  amountCents: number,
  openBeforeCents: number,
): SkontoTerm | null {
  const matches = terms.filter(
    (t) => paidAt.getTime() <= endOfUtcDay(t.dueDate).getTime() && Math.abs(amountCents - t.payableCents) <= 1,
  );
  if (matches.length === 0) return null;
  const best = matches.reduce((b, t) =>
    Math.abs(amountCents - t.payableCents) < Math.abs(amountCents - b.payableCents) ? t : b,
  );
  const restCents = openBeforeCents - amountCents;
  if (Math.abs(restCents - best.amountCents) > 1) return null;
  return best;
}

/**
 * Menschenlesbarer Zahlungsbedingungstext, z. B.:
 * "2 % Skonto bei Zahlung bis 10.06.2034 (Skontobetrag 23,80 €), zahlbar netto bis 17.06.2034."
 */
export function paymentTermsText(terms: readonly SkontoTerm[], netDueDate: Date | null): string {
  const parts = terms.map(
    (t) =>
      `${formatPercentDE(t.permille)} Skonto bei Zahlung bis ${formatDateDE(t.dueDate)} ` +
      `(Skontobetrag ${formatCents(t.amountCents)})`,
  );
  if (netDueDate) {
    parts.push(`zahlbar netto bis ${formatDateDE(netDueDate)}`);
  }
  return `${parts.join(", ")}.`;
}

/**
 * BT-20-Freitext-Syntax für XRechnung/ZUGFeRD, z. B.:
 * "#SKONTO#TAGE=7#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#\nZahlbar ..."
 */
export function xrechnungSkontoNote(terms: readonly SkontoTerm[], text: string): string {
  const lines = terms.map((t) => `#SKONTO#TAGE=${t.days}#PROZENT=${formatPercentBt20(t.permille)}#`);
  return [...lines, text].join("\n");
}
