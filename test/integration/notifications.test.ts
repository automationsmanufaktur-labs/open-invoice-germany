/**
 * Phase 8b, Task 3 — Benachrichtigungen: Scheduler-Job (`runNotificationsJob`), Dedupe,
 * Typen-Schalter, Bounce-/Recurring-Faehler-Hooks, Digest-Mail, markRead/list/unreadCount.
 *
 * Testjahr 2067 (Plan-Header). EIN gemeinsamer Org fuer die gesamte Datei (`Invoice.number`
 * global eindeutig, Muster dunning-engine.test.ts/activity-timeline.test.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { createRecurring } from "@/domain/recurring/create";
import { runDueRecurring } from "@/domain/recurring/run";
import { runNotificationsJob } from "@/domain/notifications/job";
import { loadNotificationSettings, saveNotificationSettings, ALL_NOTIFICATION_TYPES } from "@/domain/notifications/settings";
import { markEmailBounced } from "@/domain/email/email-log";
import { sendDocumentEmail } from "@/domain/email/send";
import { markRead, listNotifications, unreadCount } from "@/domain/notifications/create";
import { saveMailSettings } from "@/domain/email/settings";
import { createMemoryProvider } from "@/lib/mail/memory";
import { createInvoiceSchema, type CreateInvoiceInput, type CreateDocumentInput } from "@/schemas";

const FIX_DATE = new Date("2067-06-09T10:00:00.000Z");

let orgId: string;
let customerId: string;
let n = 0;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Notifications Test GmbH", addressLine1: "Teststr. 1", postalCode: "12345", city: "Berlin", vatId: "DE999999997", taxNumber: "1", email: "org@example.org" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Notifications Test GmbH",
    fromEmail: "rechnung@example.org",
    defaultCc: "",
    defaultBcc: "",
    copyToSelf: false,
  });

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde@example.org" },
  });
  customerId = customer.id;
});

function invoiceInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  n += 1;
  return createInvoiceSchema.parse({
    customerId,
    lines: [{ description: `Position ${n}`, quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }],
    ...extra,
  } as CreateInvoiceInput);
}

describe("loadNotificationSettings — Selbstheilung", () => {
  it("legt bei fehlender Zeile alle Typen aktiv / Digest aus an", async () => {
    const other = await dbInternal.organization.create({ data: { legalName: "Frisch GmbH", addressLine1: "X", postalCode: "1", city: "X" } });
    const settings = await loadNotificationSettings(other.id);
    expect(settings.enabledTypes.sort()).toEqual([...ALL_NOTIFICATION_TYPES].sort());
    expect(settings.emailDigest).toBe(false);
    expect(settings.lastDigestAt).toBeNull();
  });
});

describe("runNotificationsJob — Kandidaten, Dedupe, Typen-Schalter", () => {
  it("erzeugt INVOICE_DUE_TODAY/INVOICE_OVERDUE und ist beim zweiten Lauf dedupliziert (0 neu)", async () => {
    await saveNotificationSettings(orgId, { enabledTypes: [...ALL_NOTIFICATION_TYPES], emailDigest: false });

    const dueToday = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2067-06-09"), issueDate: new Date("2067-06-01") }), { now: FIX_DATE });
    await finalizeInvoice(dueToday.id, { now: FIX_DATE });

    const overdue = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2067-06-01"), issueDate: new Date("2067-05-01") }), { now: FIX_DATE });
    await finalizeInvoice(overdue.id, { now: FIX_DATE });

    const first = await runNotificationsJob(FIX_DATE, { orgId });
    expect(first.byType.INVOICE_DUE_TODAY ?? 0).toBeGreaterThanOrEqual(1);
    expect(first.byType.INVOICE_OVERDUE ?? 0).toBeGreaterThanOrEqual(1);

    const dueTodayNotif = await dbInternal.notification.findFirst({ where: { orgId, type: "INVOICE_DUE_TODAY", entityId: dueToday.id } });
    expect(dueTodayNotif).not.toBeNull();
    const overdueNotif = await dbInternal.notification.findFirst({ where: { orgId, type: "INVOICE_OVERDUE", entityId: overdue.id } });
    expect(overdueNotif).not.toBeNull();

    // Zweiter Lauf (selber Tag): dedupeKey ohne Datum -> keine neuen Eintraege fuer
    // dieselben zwei Rechnungen.
    const second = await runNotificationsJob(FIX_DATE, { orgId });
    const dueTodayCountAfter = await dbInternal.notification.count({ where: { orgId, type: "INVOICE_DUE_TODAY", entityId: dueToday.id } });
    const overdueCountAfter = await dbInternal.notification.count({ where: { orgId, type: "INVOICE_OVERDUE", entityId: overdue.id } });
    expect(dueTodayCountAfter).toBe(1);
    expect(overdueCountAfter).toBe(1);
    expect(second.errors).toEqual([]);
  });

  it("Typen-Schalter aus: deaktivierter Typ erzeugt keine Benachrichtigung", async () => {
    const invoice = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2067-06-09"), issueDate: new Date("2067-06-01") }), { now: FIX_DATE });
    await finalizeInvoice(invoice.id, { now: FIX_DATE });

    const enabled = ALL_NOTIFICATION_TYPES.filter((t) => t !== "INVOICE_DUE_TODAY");
    await saveNotificationSettings(orgId, { enabledTypes: enabled, emailDigest: false });

    await runNotificationsJob(FIX_DATE, { orgId });
    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "INVOICE_DUE_TODAY", entityId: invoice.id } });
    expect(notif).toBeNull();

    // Wiederherstellen fuer nachfolgende Tests.
    await saveNotificationSettings(orgId, { enabledTypes: [...ALL_NOTIFICATION_TYPES], emailDigest: false });
  });

  it("DUNNING_STAGE_REACHED: faellige Mahnstufe erzeugt eine Benachrichtigung", async () => {
    const invoice = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2067-06-01"), issueDate: new Date("2067-05-01") }), { now: FIX_DATE });
    const finalized = await finalizeInvoice(invoice.id, { now: FIX_DATE }); // 8 Tage ueberfaellig, Stufe 0 ab Tag 3 faellig

    await runNotificationsJob(FIX_DATE, { orgId });

    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "DUNNING_STAGE_REACHED", entityId: finalized.id } });
    expect(notif).not.toBeNull();
  });

  it("QUOTE_EXPIRING: Angebot mit validUntil in <=3 Tagen erzeugt eine Benachrichtigung", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        validUntil: new Date("2067-06-11"), // 2 Tage nach FIX_DATE
        lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      } as CreateDocumentInput,
      { now: FIX_DATE },
    );

    await runNotificationsJob(FIX_DATE, { orgId });

    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "QUOTE_EXPIRING", entityId: quote.id } });
    expect(notif).not.toBeNull();
  });
});

describe("Hooks: Bounce, Recurring-Fehler", () => {
  it("markEmailBounced loest onEmailBounced aus (EMAIL_BOUNCED-Benachrichtigung)", async () => {
    const invoice = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(invoice.id, { now: FIX_DATE });
    const provider = createMemoryProvider();

    const sendResult = await sendDocumentEmail(
      orgId,
      "tester",
      {
        docType: "INVOICE",
        docId: finalized.id,
        to: "kunde@example.org",
        cc: "",
        bcc: "",
        subject: "Ihre Rechnung",
        body: "Text",
        signature: "",
        copyToSelf: false,
        standardAttachments: [],
        warnings: [],
      },
      [],
      provider,
    );
    expect(sendResult.status).toBe("SENT");

    await markEmailBounced(orgId, sendResult.logId, "tester", FIX_DATE);

    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "EMAIL_BOUNCED", entityId: finalized.id } });
    expect(notif).not.toBeNull();

    const log = await dbInternal.emailLog.findUnique({ where: { id: sendResult.logId } });
    expect(log?.status).toBe("BOUNCED");

    const activity = await dbInternal.activityLog.findFirst({ where: { orgId, entityType: "INVOICE", entityId: finalized.id, type: "BOUNCED" } });
    expect(activity).not.toBeNull();

    // Erneuter Aufruf mit demselben logId -> dedupliziert (kein zweiter Eintrag).
    await markEmailBounced(orgId, sendResult.logId, "tester", FIX_DATE);
    const count = await dbInternal.notification.count({ where: { orgId, type: "EMAIL_BOUNCED", entityId: finalized.id } });
    expect(count).toBe(1);
  });

  it("runDueRecurring: ein fehlgeschlagenes Abo bricht andere Abos NICHT ab und loest onRecurringFailed aus", async () => {
    const goodAbo = await createRecurring(orgId, {
      customerId,
      title: "Gutes Abo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2067-06-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      paymentTermsDays: 14,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    const brokenAbo = await createRecurring(orgId, {
      customerId,
      title: "Kaputtes Abo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2067-06-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      paymentTermsDays: 14,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    // Positionen entfernen -> emitOne wirft "Abo hat keine Positionen." (RecurringError).
    await dbInternal.recurringInvoiceLine.deleteMany({ where: { recurringInvoiceId: brokenAbo.id } });

    const summaries = await runDueRecurring({ now: new Date("2067-07-01T10:00:00.000Z"), orgId });

    const goodSummary = summaries.find((s) => s.recurringId === goodAbo.id);
    const brokenSummary = summaries.find((s) => s.recurringId === brokenAbo.id);
    expect(goodSummary?.emitted.length).toBeGreaterThanOrEqual(1);
    expect(goodSummary?.error).toBeUndefined();
    expect(brokenSummary?.error).toContain("Positionen");

    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "RECURRING_FAILED", entityId: brokenAbo.id } });
    expect(notif).not.toBeNull();
  });
});

describe("Digest-Mail", () => {
  it("versendet eine Tagesuebersicht ueber den MemoryMailProvider, wenn ungelesene Benachrichtigungen bestehen", async () => {
    // Vorherige Tests (Hooks-Block) hinterlassen ungelesene Benachrichtigungen mit `at` in
    // der realen Zukunft (2067-07-01, RECURRING_FAILED) — fuer eine saubere Ausgangslage
    // erst alles als gelesen markieren, sonst wuerde deren `createdAt` > `lastDigestAt`
    // (FIX_DATE) auch nach dem ersten Digest-Versand bestehen bleiben.
    await markRead(orgId, { all: true });
    await saveNotificationSettings(orgId, { enabledTypes: [...ALL_NOTIFICATION_TYPES], emailDigest: true });
    // Sicherstellen, dass mindestens eine ungelesene Benachrichtigung besteht.
    const invoice = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2067-06-09"), issueDate: new Date("2067-06-01") }), { now: FIX_DATE });
    await finalizeInvoice(invoice.id, { now: FIX_DATE });

    const provider = createMemoryProvider();
    const result = await runNotificationsJob(FIX_DATE, { orgId, provider });

    expect(result.digestsSent).toContain(orgId);
    expect(provider.sent.length).toBeGreaterThanOrEqual(1);
    const mail = provider.sent[provider.sent.length - 1];
    expect(mail.subject).toBe("Tagesuebersicht OpenInvoice");
    expect(mail.to).toEqual(["org@example.org"]);

    const settings = await loadNotificationSettings(orgId);
    expect(settings.lastDigestAt).not.toBeNull();

    // Ohne neue ungelesene Benachrichtigungen seit lastDigestAt: kein zweiter Versand.
    const before = provider.sent.length;
    await runNotificationsJob(FIX_DATE, { orgId, provider });
    expect(provider.sent.length).toBe(before);

    await saveNotificationSettings(orgId, { enabledTypes: [...ALL_NOTIFICATION_TYPES], emailDigest: false });
  });
});

describe("markRead / listNotifications / unreadCount", () => {
  it("markiert einzelne und alle Benachrichtigungen als gelesen", async () => {
    const before = await unreadCount(orgId);
    expect(before).toBeGreaterThan(0);

    const rows = await listNotifications(orgId, { unreadOnly: true, limit: 1 });
    expect(rows.length).toBe(1);

    const markedOne = await markRead(orgId, { ids: [rows[0].id] });
    expect(markedOne).toBe(1);

    const afterOne = await unreadCount(orgId);
    expect(afterOne).toBe(before - 1);

    const markedAll = await markRead(orgId, { all: true });
    expect(markedAll).toBe(afterOne);

    const finalUnread = await unreadCount(orgId);
    expect(finalUnread).toBe(0);
  });
});
