/**
 * Mahnwesen-Uebersicht (Phase 6, Task 4) — aggregiert alle ueberfaelligen, offenen
 * Rechnungen einer Organisation fuer `/mahnwesen` (Widgets + Tabelle). Rein lesend,
 * nutzt dieselbe Zeitplan-Logik wie die Erstellung (`dunningScheduleFor`), damit
 * "naechste Stufe faellig ab" auf der Uebersicht exakt dem entspricht, was
 * `createDunning` tatsaechlich anwenden wuerde.
 */
import { dbInternal } from "@/lib/db";
import { openAmountCents as computeOpenAmountCents } from "@/domain/invoice/amounts";
import { dunningScheduleFor, type StageLike } from "@/domain/dunning/schedule";
import { loadDunningSettings } from "@/domain/dunning/settings";
import { ensureDunningSnapshots } from "@/domain/dunning/snapshot";
import { DUNNABLE_TYPES } from "@/domain/dunning/create";
import { agingBuckets } from "@/domain/dashboard/summary";
import { utcDateOnly } from "@/lib/date-only";

export interface DunningOverviewFilter {
  customerId?: string;
  state?: "ACTIVE" | "PAUSED" | "STOPPED";
  /** Filtert auf die AKTUELLE Mahnstufe (order der letzten erstellten Mahnung); Rechnungen
   *  ohne bisherige Mahnung (currentStage === null) matchen nie. */
  stageOrder?: number;
}

/** Feste Vier-Bucket-Form (Phase 6, unveraendert nach aussen) — wird lokal aus dem
 *  generalisierten `agingBuckets`-Array (Fix-Runde 1, Task 4) zusammengesetzt. */
export interface AgingBucket {
  count: number;
  cents: number;
}
export interface AgingBuckets {
  d1_7: AgingBucket;
  d8_30: AgingBucket;
  d31_60: AgingBucket;
  d60plus: AgingBucket;
}

export interface DunningOverviewRow {
  invoiceId: string;
  number: string | null;
  customerName: string;
  grossCents: number;
  paidCents: number;
  openCents: number;
  dueDate: Date;
  daysOverdue: number;
  currentStage: { name: string; order: number } | null;
  nextStage: { name: string; order: number } | null;
  nextDunningAt: Date | null;
  dunningState: string;
  pausedUntil: Date | null;
  lastContactAt: Date | null;
}

export interface DunningOverview {
  widgets: {
    overdueCount: number;
    openTotalCents: number;
    aging: AgingBuckets;
  };
  rows: DunningOverviewRow[];
}

export async function loadDunningOverview(orgId: string, now: Date = new Date(), filter: DunningOverviewFilter = {}): Promise<DunningOverview> {
  // S2 (Fix-Welle): Selbstheilung fuer Altmahnungen beim Laden von /mahnwesen anstossen
  // (zweiter Aufrufer neben runDunningJob) — vorher hatte ensureDunningSnapshots keinen
  // produktiven Aufrufer.
  await ensureDunningSnapshots(orgId);
  const settings = await loadDunningSettings(orgId);

  const stages: (StageLike & { name: string })[] = await dbInternal.dunningStage.findMany({
    where: { orgId },
    select: { order: true, enabled: true, daysAfterDue: true, name: true },
  });

  // S6 (Fix-Welle): explizites `select` statt `include` ohne Einschraenkung — vorher kam
  // jede passende Rechnung MIT `taxBreakdownJson`/`sellerSnapshotJson`/`buyerSnapshotJson`/
  // `notes`/`internalNotes` usw. in den Speicher, obwohl nur ein Bruchteil der Felder
  // tatsaechlich benutzt wird (CLAUDE.md: "Prisma immer mit select/include"). Faelligkeit
  // (dueDate bzw. Fallback issueDate) zusaetzlich in die where-Klausel gezogen statt erst
  // in JS zu filtern, damit nicht-faellige Rechnungen gar nicht erst geladen werden.
  const invoices = await dbInternal.invoice.findMany({
    where: {
      orgId,
      type: { in: Array.from(DUNNABLE_TYPES) },
      status: { in: ["FINALIZED", "SENT", "PARTIALLY_PAID"] },
      OR: [{ dueDate: { lte: now } }, { dueDate: null, issueDate: { lte: now } }],
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.state ? { dunningState: filter.state } : {}),
    },
    select: {
      id: true,
      number: true,
      grossTotalCents: true,
      paidAmountCents: true,
      payableCents: true,
      dueDate: true,
      issueDate: true,
      dunningState: true,
      dunningPausedUntil: true,
      customer: { select: { name: true } },
      dunnings: {
        orderBy: { createdAt: "desc" },
        select: { id: true, dueDate: true, sentAt: true, level: true, stage: { select: { order: true, name: true } } },
      },
    },
  });

  // Vorfilterung (offen, faellig, ggf. stageOrder) OHNE DB-Zugriffe, damit die anschliessende
  // EmailLog-Abfrage nur die tatsaechlich angezeigten Zeilen betrifft und in EINEM Batch
  // (statt einer Query je Zeile — vormals N+1, Task-4-Review) laufen kann.
  type Candidate = {
    inv: (typeof invoices)[number];
    openCents: number;
    dueDate: Date;
    daysOverdue: number;
    last: (typeof invoices)[number]["dunnings"][number] | null;
    currentStage: { name: string; order: number } | null;
  };
  const candidates: Candidate[] = [];
  for (const inv of invoices) {
    const openCents = computeOpenAmountCents(inv);
    if (openCents <= 0) continue;
    // Faelligkeit ist bereits in der where-Klausel gefiltert (dueDate <= now bzw.
    // Fallback issueDate <= now) — hier nur noch fuer daysOverdue gebraucht.
    const dueDate = inv.dueDate ?? inv.issueDate;

    // Fix-Welle (S7, Nit): kalendertaggenau (UTC) statt rohem Millisekunden-Elapsed —
    // vorher konnte eine Zeile gleichzeitig daysOverdue=0 anzeigen UND bereits im
    // "1-7 Tage"-Bucket von agingBuckets() (unten) auftauchen, weil agingBuckets bereits
    // kalendertaggenau rechnete, dieses Feld aber nicht (Uhrzeit-Anteil floss mit ein).
    const daysOverdue = Math.round((utcDateOnly(now) - utcDateOnly(dueDate)) / (1000 * 60 * 60 * 24));

    const last = inv.dunnings[0] ?? null;
    const currentStage = last ? { name: last.stage?.name ?? `Stufe ${last.level}`, order: last.stage?.order ?? last.level } : null;

    if (filter.stageOrder !== undefined && currentStage?.order !== filter.stageOrder) continue;

    candidates.push({ inv, openCents, dueDate, daysOverdue, last, currentStage });
  }

  // EIN Batch statt einer emailLog.aggregate()-Abfrage je Rechnung: groupBy ueber (docType,
  // docId) fuer alle betroffenen invoiceIds/dunningIds auf einmal, danach in-memory je
  // Rechnung auf das Maximum aus ihrer eigenen INVOICE-Zeile und allen ihren DUNNING-Zeilen
  // reduziert.
  const invoiceIds = candidates.map((c) => c.inv.id);
  const dunningToInvoice = new Map<string, string>();
  for (const c of candidates) {
    for (const d of c.inv.dunnings) dunningToInvoice.set(d.id, c.inv.id);
  }
  const dunningIds = Array.from(dunningToInvoice.keys());

  const lastContactByInvoiceId = new Map<string, Date>();
  if (invoiceIds.length > 0 || dunningIds.length > 0) {
    const grouped = await dbInternal.emailLog.groupBy({
      by: ["docType", "docId"],
      where: {
        orgId,
        sentAt: { not: null },
        OR: [
          ...(invoiceIds.length > 0 ? [{ docType: "INVOICE", docId: { in: invoiceIds } }] : []),
          ...(dunningIds.length > 0 ? [{ docType: "DUNNING", docId: { in: dunningIds } }] : []),
        ],
      },
      _max: { sentAt: true },
    });
    const bump = (invoiceId: string, sentAt: Date | null) => {
      if (!sentAt) return;
      const current = lastContactByInvoiceId.get(invoiceId);
      if (!current || sentAt.getTime() > current.getTime()) lastContactByInvoiceId.set(invoiceId, sentAt);
    };
    for (const g of grouped) {
      const sentAt = g._max.sentAt;
      if (g.docType === "INVOICE") bump(g.docId, sentAt);
      else if (g.docType === "DUNNING") {
        const invoiceId = dunningToInvoice.get(g.docId);
        if (invoiceId) bump(invoiceId, sentAt);
      }
    }
  }

  const rows: DunningOverviewRow[] = [];
  let openTotalCents = 0;

  for (const { inv, openCents, dueDate, daysOverdue, last, currentStage } of candidates) {
    const schedule = dunningScheduleFor({
      invoiceDueDate: dueDate,
      lastDunning: last ? { order: currentStage!.order, dueDate: last.dueDate, sentAt: last.sentAt } : null,
      stages,
      gracePeriodDays: settings.gracePeriodDays,
      now,
    });

    rows.push({
      invoiceId: inv.id,
      number: inv.number,
      customerName: inv.customer.name,
      grossCents: inv.grossTotalCents,
      paidCents: inv.paidAmountCents,
      openCents,
      dueDate,
      daysOverdue,
      currentStage,
      nextStage: schedule.nextStage ? { name: schedule.nextStage.name, order: schedule.nextStage.order } : null,
      nextDunningAt: schedule.dueAt,
      dunningState: inv.dunningState,
      pausedUntil: inv.dunningPausedUntil,
      lastContactAt: lastContactByInvoiceId.get(inv.id) ?? null,
    });

    openTotalCents += openCents;
  }

  // Aging-Buckets ueber den geteilten, generalisierten Helfer (Task-4-Brief, Fix-Runde 1):
  // dieselbe Grenzwahl (7/30/60 Tage, minDays: 1 -> daysOverdue===0 zaehlt nicht, §25) wie
  // bisher; das Array-Ergebnis wird hier in die feste Vier-Schluessel-Form zurueckgebaut,
  // damit sich am oeffentlichen `DunningOverview`-Vertrag (Route/OverviewWidgets/Tests)
  // nichts aendert.
  const agingArray = agingBuckets(
    rows.map((r) => ({ dueDate: r.dueDate, cents: r.openCents })),
    now,
    [7, 30, 60],
    { minDays: 1 },
  );
  const aging: AgingBuckets = {
    d1_7: { count: agingArray[0].count, cents: agingArray[0].cents },
    d8_30: { count: agingArray[1].count, cents: agingArray[1].cents },
    d31_60: { count: agingArray[2].count, cents: agingArray[2].cents },
    d60plus: { count: agingArray[3].count, cents: agingArray[3].cents },
  };

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    widgets: { overdueCount: rows.length, openTotalCents, aging },
    rows,
  };
}
