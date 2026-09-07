/**
 * Scheduler-Job `notifications` (Phase 8b, Task 3) — registriert in
 * `src/domain/scheduler/jobs.ts` (Reihenfolge recurring -> dunning -> notifications,
 * Task-3-Facts). Erzeugt je Organisation Kandidaten-Benachrichtigungen (faellig/
 * ueberfaellig/Mahnstufe/Angebot laeuft ab) und versendet — wenn `emailDigest` aktiv ist
 * und seit `lastDigestAt` ungelesene Benachrichtigungen bestehen — eine taegliche
 * Sammel-Mail ueber den konfigurierten `MailProvider`.
 *
 * Dieselben mahnbaren Typen/Status wie `dunning/auto.ts` (DUNNABLE_TYPES/-STATUSES) —
 * kein zweites, abweichendes Kandidaten-Set.
 */
import { dbInternal } from "@/lib/db";
import { createNotification } from "@/domain/notifications/create";
import { loadNotificationSettings, markDigestSent, type NotificationType } from "@/domain/notifications/settings";
import { DUNNABLE_TYPES } from "@/domain/dunning/create";
import { dunningScheduleFor, latestDunning } from "@/domain/dunning/schedule";
import { loadDunningSettings } from "@/domain/dunning/settings";
import { openAmountCents } from "@/domain/invoice/amounts";
import { loadMailSettings } from "@/domain/email/settings";
import { createSmtpProvider } from "@/lib/mail/smtp";
import type { MailProvider } from "@/lib/mail/provider";

const DUNNABLE_STATUSES = new Set(["FINALIZED", "SENT", "PARTIALLY_PAID"]);
const QUOTE_EXPIRING_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateOnly(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface RunNotificationsJobOptions {
  provider?: MailProvider;
  orgId?: string;
}

export interface RunNotificationsJobResult {
  orgs: number;
  created: number;
  byType: Record<string, number>;
  digestsSent: string[];
  errors: { orgId: string; message: string }[];
}

function bump(byType: Record<string, number>, type: NotificationType): void {
  byType[type] = (byType[type] ?? 0) + 1;
}

async function processDueAndOverdue(orgId: string, now: Date, enabled: Set<NotificationType>, byType: Record<string, number>): Promise<void> {
  if (!enabled.has("INVOICE_DUE_TODAY") && !enabled.has("INVOICE_OVERDUE")) return;

  const candidates = await dbInternal.invoice.findMany({
    where: { orgId, status: { in: [...DUNNABLE_STATUSES] }, dueDate: { not: null } },
    select: { id: true, number: true, dueDate: true, grossTotalCents: true, paidAmountCents: true, payableCents: true },
  });

  const today = utcDateOnly(now);
  for (const inv of candidates) {
    if (!inv.dueDate) continue;
    if (openAmountCents(inv) <= 0) continue;
    const due = utcDateOnly(inv.dueDate);

    if (enabled.has("INVOICE_DUE_TODAY") && due === today) {
      const res = await createNotification({
        orgId,
        type: "INVOICE_DUE_TODAY",
        title: `Rechnung ${inv.number ?? inv.id} heute faellig`,
        link: `/rechnungen/${inv.id}`,
        entityType: "INVOICE",
        entityId: inv.id,
        dedupeKey: `INVOICE_DUE_TODAY:${inv.id}`,
        at: now,
      });
      if (res) bump(byType, "INVOICE_DUE_TODAY");
    }

    // Ruling (Task-3-Facts): dedupeKey OHNE Datum — nur einmal je Rechnung ueber die
    // gesamte Laufzeit, nicht taeglich neu.
    if (enabled.has("INVOICE_OVERDUE") && due < today) {
      const res = await createNotification({
        orgId,
        type: "INVOICE_OVERDUE",
        title: `Rechnung ${inv.number ?? inv.id} ueberfaellig`,
        link: `/rechnungen/${inv.id}`,
        entityType: "INVOICE",
        entityId: inv.id,
        dedupeKey: `INVOICE_OVERDUE:${inv.id}`,
        at: now,
      });
      if (res) bump(byType, "INVOICE_OVERDUE");
    }
  }
}

async function processDunningStages(orgId: string, now: Date, enabled: Set<NotificationType>, byType: Record<string, number>): Promise<void> {
  if (!enabled.has("DUNNING_STAGE_REACHED")) return;

  const settings = await loadDunningSettings(orgId);
  const stages = await dbInternal.dunningStage.findMany({ where: { orgId }, select: { id: true, order: true, enabled: true, daysAfterDue: true } });

  const candidates = await dbInternal.invoice.findMany({
    where: { orgId, type: { in: Array.from(DUNNABLE_TYPES) }, status: { in: [...DUNNABLE_STATUSES] }, dunningState: { not: "STOPPED" } },
    select: {
      id: true,
      number: true,
      dueDate: true,
      issueDate: true,
      grossTotalCents: true,
      paidAmountCents: true,
      payableCents: true,
      dunnings: { select: { createdAt: true, dueDate: true, sentAt: true, level: true, stage: { select: { order: true } } } },
    },
  });

  for (const inv of candidates) {
    if (openAmountCents(inv) <= 0) continue;
    const dueDate = inv.dueDate ?? inv.issueDate;
    const last = latestDunning(inv.dunnings);
    const lastOrder = last ? (last.stage?.order ?? last.level) : null;
    const schedule = dunningScheduleFor({
      invoiceDueDate: dueDate,
      lastDunning: last ? { order: lastOrder!, dueDate: last.dueDate, sentAt: last.sentAt } : null,
      stages,
      gracePeriodDays: settings.gracePeriodDays,
      now,
    });
    if (!schedule.isDue || !schedule.nextStage) continue;

    const res = await createNotification({
      orgId,
      type: "DUNNING_STAGE_REACHED",
      title: `Mahnstufe faellig fuer Rechnung ${inv.number ?? inv.id}`,
      link: `/rechnungen/${inv.id}`,
      entityType: "INVOICE",
      entityId: inv.id,
      dedupeKey: `DUNNING_STAGE_REACHED:${inv.id}:${schedule.nextStage.order}`,
      at: now,
    });
    if (res) bump(byType, "DUNNING_STAGE_REACHED");
  }
}

async function processQuoteExpiring(orgId: string, now: Date, enabled: Set<NotificationType>, byType: Record<string, number>): Promise<void> {
  if (!enabled.has("QUOTE_EXPIRING")) return;

  const windowEnd = new Date(now.getTime() + QUOTE_EXPIRING_WINDOW_DAYS * DAY_MS);
  const candidates = await dbInternal.quote.findMany({
    where: { orgId, status: { in: ["DRAFT", "SENT"] }, validUntil: { not: null, gte: now, lte: windowEnd } },
    select: { id: true, number: true, validUntil: true },
  });

  for (const q of candidates) {
    const res = await createNotification({
      orgId,
      type: "QUOTE_EXPIRING",
      title: `Angebot ${q.number ?? q.id} laeuft bald ab`,
      link: `/dokumente/${q.id}`,
      entityType: "QUOTE",
      entityId: q.id,
      dedupeKey: `QUOTE_EXPIRING:${q.id}`,
      at: now,
    });
    if (res) bump(byType, "QUOTE_EXPIRING");
  }
}

async function sendDigestIfDue(orgId: string, now: Date, provider: MailProvider | undefined, result: RunNotificationsJobResult): Promise<void> {
  const settings = await loadNotificationSettings(orgId);
  if (!settings.emailDigest) return;

  const unread = await dbInternal.notification.findMany({
    where: { orgId, readAt: null, ...(settings.lastDigestAt ? { createdAt: { gt: settings.lastDigestAt } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (unread.length === 0) return;

  try {
    const mailSettings = await loadMailSettings(orgId);
    if (!mailSettings) return;
    const org = await dbInternal.organization.findUnique({ where: { id: orgId }, select: { email: true } });
    const to = org?.email || mailSettings.fromEmail;
    const prov = provider ?? createSmtpProvider(mailSettings);

    const lines = unread.map((n) => `- ${n.title}${n.body ? `: ${n.body}` : ""}`);
    await prov.send({
      from: { name: mailSettings.fromName, address: mailSettings.fromEmail },
      to: [to],
      cc: [],
      bcc: [],
      replyTo: mailSettings.replyTo ?? undefined,
      subject: "Tagesuebersicht OpenInvoice",
      text: `${unread.length} neue Benachrichtigung(en):\n\n${lines.join("\n")}`,
      attachments: [],
    });
    await markDigestSent(orgId, now);
    result.digestsSent.push(orgId);
  } catch (e) {
    result.errors.push({ orgId, message: e instanceof Error ? e.message : String(e) });
  }
}

export async function runNotificationsJob(now: Date = new Date(), opts: RunNotificationsJobOptions = {}): Promise<RunNotificationsJobResult> {
  const result: RunNotificationsJobResult = { orgs: 0, created: 0, byType: {}, digestsSent: [], errors: [] };

  const orgs = opts.orgId
    ? [{ id: opts.orgId }]
    : await dbInternal.organization.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });

  for (const org of orgs) {
    result.orgs += 1;
    try {
      const settings = await loadNotificationSettings(org.id);
      const enabled = new Set(settings.enabledTypes);

      await processDueAndOverdue(org.id, now, enabled, result.byType);
      await processDunningStages(org.id, now, enabled, result.byType);
      await processQuoteExpiring(org.id, now, enabled, result.byType);
      await sendDigestIfDue(org.id, now, opts.provider, result);
    } catch (e) {
      result.errors.push({ orgId: org.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  result.created = Object.values(result.byType).reduce((s, n) => s + n, 0);
  return result;
}
