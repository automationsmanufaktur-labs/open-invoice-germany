/**
 * Verlaufs-/Zeitstrahl-Ansicht eines Belegs (Phase 8b, Task 3) — mischt ActivityLog-
 * Eintraege, EmailLog-Versuche, Zahlungen, Mahnungen und abgeleitete Meilensteine zu einer
 * einzigen, aufsteigend sortierten Liste. Rein lesend, kein Schreibzugriff.
 *
 * `docId` ist ueber alle Belegtypen hinweg eindeutig (Task-2-Report, RowActionsMenu/
 * hasEmailLog) — EmailLog wird deshalb nur nach `docId` gefiltert, ohne docType-
 * Unterscheidung (ein Angebot traegt je nach `kind` ANGEBOT/AUFTRAGSBESTAETIGUNG/PROFORMA
 * als EmailLog.docType, alle drei gehoeren zu genau diesem Beleg).
 */
import { dbInternal } from "@/lib/db";
import { ACTIVITY_TYPES, type ActivityEntityType, type ActivityType } from "@/domain/activity/log";
import { dunningScheduleFor, latestDunning } from "@/domain/dunning/schedule";
import { loadDunningSettings } from "@/domain/dunning/settings";
import { openAmountCents } from "@/domain/invoice/amounts";
import { formatCents } from "@/lib/money";

export type TimelineKind = "INVOICE" | "QUOTE" | "DELIVERY_NOTE";
export type TimelineEntryKind = "activity" | "email" | "payment" | "dunning" | "milestone";

export interface TimelineEntry {
  at: Date;
  kind: TimelineEntryKind;
  label: string;
  detail?: string;
  actor?: string;
}

const DUNNABLE_STATUSES = new Set(["FINALIZED", "SENT", "PARTIALLY_PAID"]);

function activityLabel(type: string): string {
  return (ACTIVITY_TYPES as Record<string, string>)[type] ?? type;
}

async function activityEntries(orgId: string, entityType: ActivityEntityType, id: string): Promise<TimelineEntry[]> {
  const rows = await dbInternal.activityLog.findMany({
    where: { orgId, entityType, entityId: id },
    orderBy: { at: "asc" },
  });
  return rows.map((r) => ({
    at: r.at,
    kind: "activity" as const,
    label: activityLabel(r.type as ActivityType),
    actor: r.actor,
  }));
}

async function emailEntries(orgId: string, docId: string): Promise<TimelineEntry[]> {
  const rows = await dbInternal.emailLog.findMany({
    where: { orgId, docId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    at: r.sentAt ?? r.createdAt,
    kind: "email" as const,
    label: r.status === "SENT" ? "E-Mail versendet" : r.status === "FAILED" ? "E-Mail-Versand fehlgeschlagen" : `E-Mail ${r.status}`,
    detail: r.subject,
  }));
}

/**
 * Fix-Welle (Nit): `detail` hardcodete "EUR" unabhaengig von `Invoice.currency` — bei
 * einer Fremdwaehrungsrechnung (z. B. USD) zeigte die Zeitleiste trotzdem "EUR" an.
 * `formatCents` (lib/money.ts) uebernimmt jetzt die tatsaechliche Waehrung des Belegs.
 */
async function paymentEntries(orgId: string, invoiceId: string): Promise<TimelineEntry[]> {
  const inv = await dbInternal.invoice.findFirst({ where: { id: invoiceId, orgId }, select: { currency: true } });
  const currency = inv?.currency ?? "EUR";
  const rows = await dbInternal.payment.findMany({ where: { invoiceId }, orderBy: { paidAt: "asc" } });
  return rows.map((p) => ({
    at: p.paidAt,
    kind: "payment" as const,
    label: p.isSkonto ? "Skontoabzug gebucht" : "Zahlung erfasst",
    detail: `${formatCents(p.amountCents, currency)} (${p.method})`,
  }));
}

async function dunningEntries(invoiceId: string): Promise<TimelineEntry[]> {
  const rows = await dbInternal.dunning.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } });
  const entries: TimelineEntry[] = [];
  for (const d of rows) {
    entries.push({ at: d.createdAt, kind: "dunning" as const, label: "Mahnung erstellt", detail: d.number ?? undefined });
  }
  return entries;
}

async function invoiceMilestones(orgId: string, invoiceId: string, now: Date): Promise<TimelineEntry[]> {
  const inv = await dbInternal.invoice.findFirst({
    where: { id: invoiceId, orgId },
    select: {
      dueDate: true,
      status: true,
      type: true,
      grossTotalCents: true,
      paidAmountCents: true,
      payableCents: true,
      dunningState: true,
      dunnings: {
        select: { createdAt: true, dueDate: true, sentAt: true, level: true, stage: { select: { order: true } } },
      },
    },
  });
  if (!inv) return [];

  const entries: TimelineEntry[] = [];

  // Zahlungsziel erreicht: dueDate <= now und Rechnung noch nicht (vollstaendig) bezahlt.
  if (inv.dueDate && inv.dueDate.getTime() <= now.getTime() && inv.status !== "PAID" && inv.status !== "CANCELLED") {
    entries.push({ at: inv.dueDate, kind: "milestone" as const, label: "Zahlungsziel erreicht" });
  }

  // Mahnstufe faellig: nur fuer mahnbare, offene Rechnungen (analog dunning/auto.ts).
  const DUNNABLE_TYPES = new Set(["INVOICE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);
  if (DUNNABLE_TYPES.has(inv.type) && DUNNABLE_STATUSES.has(inv.status) && inv.dunningState !== "STOPPED" && inv.dueDate) {
    const openAmount = openAmountCents(inv);
    if (openAmount > 0) {
      const settings = await loadDunningSettings(orgId);
      const stages = await dbInternal.dunningStage.findMany({
        where: { orgId },
        select: { id: true, order: true, enabled: true, daysAfterDue: true },
      });
      const last = latestDunning(inv.dunnings);
      const lastOrder = last ? (last.stage?.order ?? last.level) : null;
      const schedule = dunningScheduleFor({
        invoiceDueDate: inv.dueDate,
        lastDunning: last ? { order: lastOrder!, dueDate: last.dueDate, sentAt: last.sentAt } : null,
        stages,
        gracePeriodDays: settings.gracePeriodDays,
        now,
      });
      if (schedule.nextStage && schedule.dueAt) {
        entries.push({
          at: schedule.dueAt,
          kind: "milestone" as const,
          label: schedule.isDue ? "Mahnstufe faellig" : "Naechste Mahnstufe faellig ab",
        });
      }
    }
  }

  return entries;
}

async function quoteMilestones(orgId: string, quoteId: string, now: Date): Promise<TimelineEntry[]> {
  const q = await dbInternal.quote.findFirst({ where: { id: quoteId, orgId }, select: { validUntil: true, status: true } });
  if (!q?.validUntil) return [];
  const expired = q.validUntil.getTime() < now.getTime();
  return [
    {
      at: q.validUntil,
      kind: "milestone" as const,
      label: expired ? "Angebot abgelaufen" : "Angebot laeuft ab",
    },
  ];
}

/** Baut den Zeitstrahl eines Belegs — aufsteigend nach Zeitpunkt sortiert. */
export async function buildTimeline(orgId: string, doc: { kind: TimelineKind; id: string }, now: Date = new Date()): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];

  entries.push(...(await activityEntries(orgId, doc.kind, doc.id)));
  entries.push(...(await emailEntries(orgId, doc.id)));

  if (doc.kind === "INVOICE") {
    entries.push(...(await paymentEntries(orgId, doc.id)));
    entries.push(...(await dunningEntries(doc.id)));
    entries.push(...(await invoiceMilestones(orgId, doc.id, now)));
  } else if (doc.kind === "QUOTE") {
    entries.push(...(await quoteMilestones(orgId, doc.id, now)));
  }

  entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  return entries;
}
