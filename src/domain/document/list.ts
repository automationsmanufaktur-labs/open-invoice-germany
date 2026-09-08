/**
 * Listen-Filter fuer Angebote/Auftragsbestaetigungen, Lieferscheine und Abos
 * (Phase 8b, §40) — analog `src/domain/invoice/list.ts`, aber ohne den
 * faellig/ueberfaellig-Sonderfall (der existiert nur bei Invoice/effectiveInvoiceStatus).
 * `q` sucht ueber Belegnummer + Kundenname (Volltext auf Positionen ist hier NICHT
 * Teil des Task-1-Vertrags — nur bei Rechnungen, siehe list.ts-Kommentar zu `q`).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, ciContains } from "@/lib/db";
import { QuoteStatus, DeliveryNoteStatus } from "@/schemas";
import { effectiveQuoteStatus } from "@/domain/document/status";

const baseFilterShape = {
  customerId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

function dateRangeAnd(from: Date | undefined, to: Date | undefined): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

/**
 * Fix-Runde 1 (Ruling b): EIN zusaetzlicher Query fuer die ganze Seite statt N+1 —
 * liefert die Teilmenge von `ids`, fuer die mindestens ein EmailLog existiert. `docId`
 * ist ueber alle Belegtypen hinweg eindeutig (cuid), ein Match allein auf `docId` reicht.
 */
async function hasEmailLogSet(orgId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const logs = await prisma.emailLog.findMany({ where: { orgId, docId: { in: ids } }, select: { docId: true } });
  return new Set(logs.map((l) => l.docId));
}

// ── Angebote / Auftragsbestaetigungen ────────────────────────────────────────
export const quoteListFilterSchema = z.object({
  ...baseFilterShape,
  status: z.enum(["all", ...QuoteStatus.options]).default("all"),
  kind: z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA"]).optional(),
  // Task 2: uebernimmt das bisherige Seitenverhalten (Standard: nur nicht-archivierte
  // Dokumente) als Domain-Filter statt eines Parallelcodes auf der Seite selbst.
  includeArchived: z.boolean().optional(),
});
export type QuoteListFilter = z.infer<typeof quoteListFilterSchema>;

export interface QuoteListRow {
  id: string;
  number: string | null;
  kind: string;
  customerId: string;
  customerName: string;
  issueDate: Date;
  validUntil: Date | null;
  grossTotalCents: number;
  currency: string;
  effectiveStatus: QuoteStatus;
  archivedAt: Date | null;
  hasEmailLog: boolean;
}

export interface QuoteListResult {
  rows: QuoteListRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function listQuotes(orgId: string, rawFilter: unknown, now: Date = new Date()): Promise<QuoteListResult> {
  const filter = quoteListFilterSchema.parse(rawFilter);

  const and: Prisma.QuoteWhereInput[] = [{ orgId }];
  if (filter.kind) and.push({ kind: filter.kind });
  if (filter.customerId) and.push({ customerId: filter.customerId });
  if (!filter.includeArchived) and.push({ archivedAt: null });

  // EXPIRED ist kein gespeicherter Status (effectiveQuoteStatus) — als Filter uebersetzt
  // in "status DRAFT/SENT UND validUntil < now"; alle anderen Filterwerte sind direkte
  // Statuswerte.
  if (filter.status !== "all") {
    if (filter.status === "EXPIRED") {
      and.push({ status: { in: ["DRAFT", "SENT"] }, validUntil: { lt: now } });
    } else if (filter.status === "DRAFT" || filter.status === "SENT") {
      // DRAFT/SENT im Filter meint "aktiv und NICHT abgelaufen" — sonst wuerde ein
      // abgelaufenes SENT-Angebot doppelt (unter SENT und EXPIRED) auftauchen.
      and.push({ status: filter.status, OR: [{ validUntil: null }, { validUntil: { gte: now } }] });
    } else {
      and.push({ status: filter.status });
    }
  }

  const dateRange = dateRangeAnd(filter.from, filter.to);
  if (dateRange) and.push({ issueDate: dateRange });

  if (filter.q) {
    and.push({ OR: [{ number: ciContains(filter.q) }, { customer: { name: ciContains(filter.q) } }] });
  }

  const where: Prisma.QuoteWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: { issueDate: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: {
        id: true,
        number: true,
        kind: true,
        status: true,
        customerId: true,
        customer: { select: { name: true } },
        issueDate: true,
        validUntil: true,
        grossTotalCents: true,
        currency: true,
        archivedAt: true,
      },
    }),
  ]);

  const emailLogDocIds = await hasEmailLogSet(orgId, rows.map((r) => r.id));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      customerId: r.customerId,
      customerName: r.customer.name,
      issueDate: r.issueDate,
      validUntil: r.validUntil,
      grossTotalCents: r.grossTotalCents,
      currency: r.currency,
      effectiveStatus: effectiveQuoteStatus({ status: r.status, validUntil: r.validUntil }, now),
      archivedAt: r.archivedAt,
      hasEmailLog: emailLogDocIds.has(r.id),
    })),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}

// ── Lieferscheine ────────────────────────────────────────────────────────────
export const deliveryNoteListFilterSchema = z.object({
  ...baseFilterShape,
  status: z.enum(["all", ...DeliveryNoteStatus.options]).default("all"),
  // Task 2: siehe quoteListFilterSchema.includeArchived — uebernimmt das bisherige
  // Seitenverhalten (Standard: nur nicht-archivierte Lieferscheine).
  includeArchived: z.boolean().optional(),
});
export type DeliveryNoteListFilter = z.infer<typeof deliveryNoteListFilterSchema>;

export interface DeliveryNoteListRow {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  issueDate: Date;
  status: DeliveryNoteStatus;
  archivedAt: Date | null;
  hasEmailLog: boolean;
}

export interface DeliveryNoteListResult {
  rows: DeliveryNoteListRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function listDeliveryNotes(orgId: string, rawFilter: unknown): Promise<DeliveryNoteListResult> {
  const filter = deliveryNoteListFilterSchema.parse(rawFilter);

  const and: Prisma.DeliveryNoteWhereInput[] = [{ orgId }];
  if (filter.status !== "all") and.push({ status: filter.status });
  if (filter.customerId) and.push({ customerId: filter.customerId });
  if (!filter.includeArchived) and.push({ archivedAt: null });
  const dateRange = dateRangeAnd(filter.from, filter.to);
  if (dateRange) and.push({ issueDate: dateRange });
  if (filter.q) {
    and.push({ OR: [{ number: ciContains(filter.q) }, { customer: { name: ciContains(filter.q) } }] });
  }

  const where: Prisma.DeliveryNoteWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    prisma.deliveryNote.count({ where }),
    prisma.deliveryNote.findMany({
      where,
      orderBy: { issueDate: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        customer: { select: { name: true } },
        issueDate: true,
        archivedAt: true,
      },
    }),
  ]);

  const emailLogDocIds = await hasEmailLogSet(orgId, rows.map((r) => r.id));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      customerId: r.customerId,
      customerName: r.customer.name,
      issueDate: r.issueDate,
      status: DeliveryNoteStatus.parse(r.status),
      archivedAt: r.archivedAt,
      hasEmailLog: emailLogDocIds.has(r.id),
    })),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}

// ── Abos / wiederkehrende Rechnungen ─────────────────────────────────────────
export const recurringListFilterSchema = z.object({
  ...baseFilterShape,
  status: z.enum(["all", "ACTIVE", "PAUSED", "ENDED"]).default("all"),
});
export type RecurringListFilter = z.infer<typeof recurringListFilterSchema>;

export interface RecurringListRow {
  id: string;
  title: string;
  status: string;
  customerId: string;
  customerName: string;
  nextRunDate: Date;
  currency: string;
}

export interface RecurringListResult {
  rows: RecurringListRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function listRecurring(orgId: string, rawFilter: unknown): Promise<RecurringListResult> {
  const filter = recurringListFilterSchema.parse(rawFilter);

  const and: Prisma.RecurringInvoiceWhereInput[] = [{ orgId }];
  if (filter.status !== "all") and.push({ status: filter.status });
  if (filter.customerId) and.push({ customerId: filter.customerId });
  // "from/to" filtert bei Abos auf den naechsten Ausfuehrungstermin (nextRunDate) —
  // es gibt kein issueDate, das faellige Abos sinnvoll eingrenzen wuerde.
  const dateRange = dateRangeAnd(filter.from, filter.to);
  if (dateRange) and.push({ nextRunDate: dateRange });
  if (filter.q) {
    and.push({ OR: [{ title: ciContains(filter.q) }, { customer: { name: ciContains(filter.q) } }] });
  }

  const where: Prisma.RecurringInvoiceWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    prisma.recurringInvoice.count({ where }),
    prisma.recurringInvoice.findMany({
      where,
      orderBy: { nextRunDate: "asc" },
      skip: filter.offset,
      take: filter.limit,
      select: {
        id: true,
        title: true,
        status: true,
        customerId: true,
        customer: { select: { name: true } },
        nextRunDate: true,
        currency: true,
      },
    }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      customerId: r.customerId,
      customerName: r.customer.name,
      nextRunDate: r.nextRunDate,
      currency: r.currency,
    })),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}
