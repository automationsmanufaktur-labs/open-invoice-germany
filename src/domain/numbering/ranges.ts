/**
 * Nummernkreis-Domain (Phase 7, Task 1, §34) — Uebersicht/Pflege der Nummernkreise
 * (Belege + Kunden-/Artikelnummern) und deren Vergabe fuer Kunden/Produkte. Die
 * transaktionale Vergabe fuer Belege selbst (Invoice/Quote/DeliveryNote/Dunning) bleibt
 * unveraendert in den jeweiligen finalize/status-Domain-Funktionen (upsert-increment auf
 * NumberRange) — hier nur die Verwaltung der Muster/Vorschau/Rueckstell-Guards sowie
 * dieselbe upsert-increment-Vergabe fuer Kunden-/Artikelnummern.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { InvalidOperationError } from "@/domain/errors";
import { defaultPattern, formatDocumentNumber } from "@/domain/numbering";
import { NUMBER_RANGE_DOC_TYPES, NumberRangeDocType, numberRangeInputSchema, type NumberRangeInput } from "@/schemas/settings";

export { NUMBER_RANGE_DOC_TYPES };
export type { NumberRangeDocType };

type Db = PrismaClient | Prisma.TransactionClient;

export interface NumberRangeView {
  docType: NumberRangeDocType;
  pattern: string;
  prefix: string;
  seqPadding: number;
  yearlyReset: boolean;
  currentValue: number;
  nextNumberPreview: string;
}

/**
 * Liest die "aktive" NumberRange-Zeile eines Nummernkreis-Typs (Fix-Welle Phase 7, B3).
 * Bei einem yearlyReset-Wechsel bleiben beide Zeilen (year 0 und year <Jahr>) erhalten;
 * `updateNumberRange` markiert die Zielzeile aktiv und die andere Modus-Zeile inaktiv
 * (`isActive`). Sind (Legacy-Datenstand vor dieser Spalte, oder ein Datenfehler) BEIDE
 * Zeilen aktiv, gewinnt die Jahres-Zeile (year <> 0) — sie ist die staerkere Zusage
 * ("jaehrlich zuruecksetzen" ist explizit an), damit ein Legacy-Datensatz nicht auf den
 * jahresunabhaengigen Modus zurueckfaellt.
 */
async function loadActiveRange(db: Db, orgId: string, docType: string, year: number) {
  const rows = await db.numberRange.findMany({ where: { orgId, docType, year: { in: [0, year] }, isActive: true } });
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  return rows.reduce((a, b) => (b.year !== 0 ? b : a));
}

/**
 * Datum fuer die Nummernkreis-Vorschau: das angefragte Geschaeftsjahr, aber Monat/Tag
 * von HEUTE (Nit, Final-Review) — vorher stand hier immer der 1. Januar, wodurch
 * {MM}/{DD}-Platzhalter im Muster faelschlich immer "01"/"01" zeigten statt des
 * tatsaechlichen heutigen Tages.
 */
function previewDateFor(year: number): Date {
  const now = new Date();
  return new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate()));
}

/** Formatiert die naechste Nummer eines Musters (rein, ohne DB). */
export function previewNumber(input: { prefix: string; pattern: string; seqPadding: number }, seq: number, date: Date): string {
  return formatDocumentNumber(input.pattern, {
    prefix: input.prefix,
    seq,
    padding: input.seqPadding,
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/** Uebersicht aller Nummernkreise einer Organisation fuer das angegebene Geschaeftsjahr. */
export async function listNumberRanges(orgId: string, year: number): Promise<NumberRangeView[]> {
  const previewDate = previewDateFor(year);
  const views: NumberRangeView[] = [];
  for (const docType of NUMBER_RANGE_DOC_TYPES) {
    const fallback = defaultPattern(docType);
    const row = await loadActiveRange(dbInternal, orgId, docType, year);
    const pattern = row?.pattern ?? fallback.pattern;
    const prefix = row?.prefix ?? fallback.prefix;
    const seqPadding = row?.seqPadding ?? fallback.seqPadding;
    const yearlyReset = row ? row.year !== 0 : fallback.yearlyReset;
    const currentValue = row?.currentValue ?? 0;
    views.push({
      docType,
      pattern,
      prefix,
      seqPadding,
      yearlyReset,
      currentValue,
      nextNumberPreview: previewNumber({ prefix, pattern, seqPadding }, currentValue + 1, previewDate),
    });
  }
  return views;
}

/**
 * Aktualisiert Muster/Praefix/Polsterung/yearlyReset/naechste-Nummer eines
 * Nummernkreises. Guards (GoBD, §14 Abs.4 Nr.4 — Nummern duerfen nie zurueckgedreht
 * werden): `nextValue - 1` muss >= dem bisherigen `currentValue` der Zielzeile sein;
 * fuer INVOICE/CREDIT_NOTE zusaetzlich >= dem hoechsten je in diesem Jahr vergebenen
 * Wert (ueber beide moeglichen Zeilen year 0/year <Jahr>), damit ein yearlyReset-
 * Wechsel keine bereits vergebene Rechnungsnummer erneut vergeben kann.
 */
export async function updateNumberRange(
  orgId: string,
  docType: string,
  rawInput: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<NumberRangeView> {
  NumberRangeDocType.parse(docType);
  const input: NumberRangeInput = numberRangeInputSchema.parse(rawInput);
  const year = now.getFullYear();
  const targetYear = input.yearlyReset ? year : 0;

  return dbInternal.$transaction(async (tx) => {
    const before = await loadActiveRange(tx, orgId, docType, year);
    const target = await tx.numberRange.findUnique({ where: { orgId_docType_year: { orgId, docType, year: targetYear } } });

    const targetCurrentValue = target?.currentValue ?? 0;
    if (input.nextValue - 1 < targetCurrentValue) {
      throw new InvalidOperationError(
        `Nummernkreis "${docType}" kann nicht zurueckgedreht werden: naechste Nummer waere ${input.nextValue}, ` +
          `es wurden bereits ${targetCurrentValue} Nummern vergeben.`,
      );
    }
    if (docType === "INVOICE" || docType === "CREDIT_NOTE") {
      const rowsThisYear = await tx.numberRange.findMany({ where: { orgId, docType, year: { in: [0, year] } } });
      const maxAssigned = rowsThisYear.reduce((max, r) => Math.max(max, r.currentValue), 0);
      if (input.nextValue - 1 < maxAssigned) {
        throw new InvalidOperationError(
          `Nummernkreis "${docType}" kann nicht unter die bereits vergebene Nummer ${maxAssigned} dieses Jahres gesetzt werden.`,
        );
      }
    }

    const newCurrentValue = input.nextValue - 1;
    const written = await tx.numberRange.upsert({
      where: { orgId_docType_year: { orgId, docType, year: targetYear } },
      create: {
        orgId,
        docType,
        year: targetYear,
        pattern: input.pattern,
        prefix: input.prefix,
        seqPadding: input.seqPadding,
        currentValue: newCurrentValue,
        isActive: true,
      },
      update: {
        pattern: input.pattern,
        prefix: input.prefix,
        seqPadding: input.seqPadding,
        currentValue: newCurrentValue,
        isActive: true,
      },
    });

    // B3: die andere Modus-Zeile desselben docType (year 0 <-> year <Jahr>) wird inaktiv —
    // sie bleibt fuer die Historie erhalten, vergibt aber ab jetzt keine Nummern mehr.
    const otherYear = targetYear === 0 ? year : 0;
    await tx.numberRange.updateMany({
      where: { orgId, docType, year: otherYear },
      data: { isActive: false },
    });

    await appendChangeLog(tx, {
      orgId,
      entity: "SETTINGS",
      entityId: `NUMBER_RANGE:${docType}`,
      action: "UPDATE",
      actor,
      at: now,
      diff: {
        before: before
          ? { pattern: before.pattern, prefix: before.prefix, seqPadding: before.seqPadding, yearlyReset: before.year !== 0, currentValue: before.currentValue }
          : null,
        after: { pattern: written.pattern, prefix: written.prefix, seqPadding: written.seqPadding, yearlyReset: written.year !== 0, currentValue: written.currentValue },
      },
    });

    const previewDate = previewDateFor(year);
    return {
      docType: docType as NumberRangeDocType,
      pattern: written.pattern,
      prefix: written.prefix,
      seqPadding: written.seqPadding,
      yearlyReset: written.year !== 0,
      currentValue: written.currentValue,
      nextNumberPreview: previewNumber(written, written.currentValue + 1, previewDate),
    };
  });
}

/** Vergibt (upsert-increment, wie Belege) die naechste Kundennummer einer Organisation. */
export async function assignCustomerNumber(tx: Db, orgId: string, now: Date = new Date()): Promise<string> {
  return assignDocumentNumber(tx, orgId, "CUSTOMER", now);
}

/** Vergibt (upsert-increment, wie Belege) die naechste Artikelnummer einer Organisation. */
export async function assignArticleNumber(tx: Db, orgId: string, now: Date = new Date()): Promise<string> {
  return assignDocumentNumber(tx, orgId, "PRODUCT", now);
}

/**
 * Selbstheilung fuer Bestandskunden ohne Kundennummer (Phase 7, Task 2, §34): vergibt
 * `assignCustomerNumber` idempotent und aufsteigend nach `createdAt` an alle Kunden der
 * Organisation, deren `customerNumber` noch leer ist. Wird beim ersten Laden der
 * Kundenliste aufgerufen — bereits nummerierte Kunden bleiben unangetastet, jeder Lauf
 * nach dem ersten ist ein No-Op.
 *
 * Nit (Final-Review): frueher EINE Transaktion je Kunde (bei einer grossen unnummerierten
 * Bestandskundenliste entsprechend viele einzelne Roundtrips beim ersten Laden). Jetzt EIN
 * Batch/EINE Transaktion fuer alle fehlenden Kunden — weiterhin seriell INNERHALB der
 * Transaktion (kein Promise.all): assignCustomerNumber schreibt denselben NumberRange-
 * Datensatz je Aufruf (upsert-increment), parallele Aufrufe wuerden sich gegenseitig
 * ueberschreiben/Nummern doppelt vergeben koennen.
 */
export async function ensureCustomerNumbers(orgId: string, now: Date = new Date()): Promise<void> {
  const missing = await dbInternal.customer.findMany({
    where: { orgId, customerNumber: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (missing.length === 0) return;
  await dbInternal.$transaction(async (tx) => {
    for (const c of missing) {
      const customerNumber = await assignCustomerNumber(tx, orgId, now);
      await tx.customer.update({ where: { id: c.id }, data: { customerNumber } });
    }
  });
}

/**
 * Nit (Final-Review): Pendant zu `ensureCustomerNumbers` fuer Produkte/Artikel — bisher
 * gab es keine Selbstheilung, Bestandsprodukte erhielten nie eine Artikelnummer aus dem
 * PRODUCT-Nummernkreis. Wird beim ersten Laden der Produktliste aufgerufen (analog
 * `ensureCustomerNumbers`), EIN Batch/EINE Transaktion fuer alle fehlenden Produkte.
 */
export async function ensureArticleNumbers(orgId: string, now: Date = new Date()): Promise<void> {
  const missing = await dbInternal.product.findMany({
    where: { orgId, articleNumber: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (missing.length === 0) return;
  await dbInternal.$transaction(async (tx) => {
    for (const p of missing) {
      const articleNumber = await assignArticleNumber(tx, orgId, now);
      await tx.product.update({ where: { id: p.id }, data: { articleNumber } });
    }
  });
}

/**
 * Vergibt (upsert-increment) die naechste Nummer eines beliebigen Nummernkreis-Typs auf
 * der AKTIVEN Zeile (`loadActiveRange`) — Fix-Welle Phase 7 (B3): ersetzt die frueher an
 * fuenf Stellen (invoice/finalize, document/create, document/status, dunning/create,
 * delivery-note/create) dupliziert hartcodierte `where: { year: now.getFullYear() }`-
 * Vergabe, die bei `yearlyReset:false` die falsche (nie gelesene) Zeile bediente.
 */
export async function assignDocumentNumber(tx: Db, orgId: string, docType: string, now: Date): Promise<string> {
  const fallback = defaultPattern(docType);
  const active = await loadActiveRange(tx, orgId, docType, now.getFullYear());
  const year = active ? active.year : fallback.yearlyReset ? now.getFullYear() : 0;
  const range = await tx.numberRange.upsert({
    where: { orgId_docType_year: { orgId, docType, year } },
    create: {
      orgId,
      docType,
      year,
      currentValue: 1,
      prefix: fallback.prefix,
      pattern: fallback.pattern,
      seqPadding: fallback.seqPadding,
      isActive: true,
    },
    update: { currentValue: { increment: 1 } },
  });
  return formatDocumentNumber(range.pattern, {
    prefix: range.prefix || fallback.prefix,
    seq: range.currentValue,
    padding: range.seqPadding,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}
