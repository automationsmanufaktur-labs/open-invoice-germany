/**
 * Phase 6, Task 3 — Scheduler-Runner (`runScheduledJobs`), Mahn-Job (`runDunningJob`).
 * Eigenes Jahr fuer die Nummernvergabe: 2051 (Plan-Header). EIN gemeinsamer Org fuer die
 * gesamte Datei (wie dunning-engine.test.ts) — `Invoice.number` ist GLOBAL eindeutig.
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { runDunningJob } from "@/domain/dunning/auto";
import { runScheduledJobs } from "@/domain/scheduler/runner";
import { setDunningState } from "@/domain/dunning/state";
import { updateDunningStage, listDunningStages } from "@/domain/dunning/stages";
import { saveDunningSettings } from "@/domain/dunning/settings";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { saveMailSettings } from "@/domain/email/settings";
import { createMemoryProvider } from "@/lib/mail/memory";
import { createRecurring } from "@/domain/recurring/create";
import { runDueRecurring } from "@/domain/recurring/run";
import type { CreateInvoiceInput } from "@/schemas";

const FIX_DATE = new Date("2051-06-09T10:00:00.000Z"); // 8 Tage nach dueDate (2051-06-01)

let orgId: string;
let n = 0;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Scheduler Test GmbH", addressLine1: "Teststr. 1", postalCode: "12345", city: "Berlin", vatId: "DE888888888", taxNumber: "1" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  // Test-Isolation: der Runner-Job "recurring" laeuft OHNE Org-Filter (wie in Produktion).
  // ACTIVE-Abos anderer Testdateien (gemeinsame Test-DB, Dateireihenfolge nicht
  // deterministisch) wuerden zum Stichtag 2051 mit abgearbeitet und ihre Rechnungen im
  // Nummernkreis 2051 IHRER Org nummeriert — `Invoice.number` ist aber GLOBAL eindeutig
  // (docs/LIMITATIONEN.md), RE-2051-0001 kollidiert dann mit dieser Org: Job FAILED,
  // "Lock stale"/"Jobreihenfolge" scheitern (CI-Befund PR #13–#17). Fremde Abos pausieren.
  await dbInternal.recurringInvoice.updateMany({ where: { orgId: { not: orgId }, status: "ACTIVE" }, data: { status: "PAUSED" } });
  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Scheduler Test GmbH",
    fromEmail: "rechnung@example.org",
    defaultCc: "",
    defaultBcc: "",
    copyToSelf: false,
  });
});

async function makeCustomer(email?: string) {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId, name: `Kunde ${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: email ?? null },
  });
  return c.id;
}

function invoiceInput(customerId: string, dueDate: Date): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: dueDate,
    dueDate,
    lines: [{ description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
  } as CreateInvoiceInput;
}

async function makeFinalizedInvoice(customerId: string, dueDate: Date) {
  const draft = await createDraftInvoice(orgId, invoiceInput(customerId, dueDate));
  return finalizeInvoice(draft.id, { now: FIX_DATE });
}

describe("Phase 6 — runDunningJob (dunning/auto.ts)", () => {
  it("faellige Rechnung -> genau eine Mahnung, nicht faellige -> keine", async () => {
    const dueCustomer = await makeCustomer();
    const notDueCustomer = await makeCustomer();
    const due = await makeFinalizedInvoice(dueCustomer, new Date("2051-06-01")); // 8 Tage ueberfaellig -> Stufe 0 faellig (daysAfterDue 3)
    const notDue = await makeFinalizedInvoice(notDueCustomer, new Date("2051-06-08")); // 1 Tag ueberfaellig -> noch nicht faellig

    const result = await runDunningJob(FIX_DATE, { orgId });
    expect(result.created).toHaveLength(1);
    const dunning = await dbInternal.dunning.findFirst({ where: { invoiceId: due.id } });
    expect(dunning).not.toBeNull();
    const noDunning = await dbInternal.dunning.findFirst({ where: { invoiceId: notDue.id } });
    expect(noDunning).toBeNull();
    expect(result.skipped.notDue).toBeGreaterThanOrEqual(1);
  });

  it("zweiter Lauf am selben Tag -> 0 neue Mahnungen fuer dieselbe Rechnung", async () => {
    const customerId = await makeCustomer();
    const inv = await makeFinalizedInvoice(customerId, new Date("2051-06-01"));

    const r1 = await runDunningJob(FIX_DATE, { orgId });
    expect(r1.created).toContain((await dbInternal.dunning.findFirstOrThrow({ where: { invoiceId: inv.id } })).id);

    const countAfterFirst = await dbInternal.dunning.count({ where: { invoiceId: inv.id } });
    const r2 = await runDunningJob(FIX_DATE, { orgId });
    const countAfterSecond = await dbInternal.dunning.count({ where: { invoiceId: inv.id } });
    expect(countAfterSecond).toBe(countAfterFirst);
    expect(r2.created).not.toContain(inv.id);
  });

  it("PAUSED (Frist in der Zukunft) wird uebersprungen", async () => {
    const customerId = await makeCustomer();
    const inv = await makeFinalizedInvoice(customerId, new Date("2051-06-01"));
    await setDunningState(orgId, inv.id, { state: "PAUSED", pausedUntil: "2051-12-31" }, "test");

    const result = await runDunningJob(FIX_DATE, { orgId });
    expect(result.created).not.toContain(inv.id);
    const dunning = await dbInternal.dunning.findFirst({ where: { invoiceId: inv.id } });
    expect(dunning).toBeNull();
    expect(result.skipped.paused).toBeGreaterThanOrEqual(1);
  });

  it("STOPPED wird uebersprungen", async () => {
    const customerId = await makeCustomer();
    const inv = await makeFinalizedInvoice(customerId, new Date("2051-06-01"));
    await setDunningState(orgId, inv.id, { state: "STOPPED" }, "test");

    const result = await runDunningJob(FIX_DATE, { orgId });
    const dunning = await dbInternal.dunning.findFirst({ where: { invoiceId: inv.id } });
    expect(dunning).toBeNull();
    expect(result.created.some((id) => id === inv.id)).toBe(false);
  });

  it("autoSend global aus -> Mahnung erstellt, aber nicht versendet (sentAt-Feld unveraendert, kein EmailLog)", async () => {
    await saveDunningSettings(orgId, { autoCreate: true, autoSend: false, baseInterestRateBp: 127, baseRateValidFrom: null, gracePeriodDays: 0 });
    const stages = await listDunningStages(orgId);
    const stage0 = stages.find((s) => s.order === 0)!;
    await updateDunningStage(orgId, stage0.id, { ...stage0, autoSend: true });

    const customerId = await makeCustomer("kunde@example.org");
    await makeFinalizedInvoice(customerId, new Date("2051-06-01"));

    const result = await runDunningJob(FIX_DATE, { orgId });
    expect(result.created).toHaveLength(1);
    expect(result.sent).toHaveLength(0);
    const log = await dbInternal.emailLog.findFirst({ where: { orgId, docId: result.created[0]!, docType: "DUNNING" } });
    expect(log).toBeNull();
  });

  it("autoSend global + Stufe an -> EmailLog per MemoryMailProvider", async () => {
    await saveDunningSettings(orgId, { autoCreate: true, autoSend: true, baseInterestRateBp: 127, baseRateValidFrom: null, gracePeriodDays: 0 });
    const stages = await listDunningStages(orgId);
    const stage0 = stages.find((s) => s.order === 0)!;
    await updateDunningStage(orgId, stage0.id, { ...stage0, autoSend: true });

    const customerId = await makeCustomer("kunde2@example.org");
    await makeFinalizedInvoice(customerId, new Date("2051-06-01"));

    const provider = createMemoryProvider();
    const result = await runDunningJob(FIX_DATE, { orgId, provider });
    expect(result.created).toHaveLength(1);
    expect(result.sent).toHaveLength(1);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to).toEqual(["kunde2@example.org"]);
    const log = await dbInternal.emailLog.findFirst({ where: { orgId, docId: result.created[0]!, docType: "DUNNING" } });
    expect(log?.status).toBe("SENT");
  });

  it("Mailfehler -> errors[], aber created[] bleibt voll", async () => {
    const customerId = await makeCustomer("kunde3@example.org");
    await makeFinalizedInvoice(customerId, new Date("2051-06-01"));

    const provider = createMemoryProvider();
    provider.failNext("SMTP down");
    const result = await runDunningJob(FIX_DATE, { orgId, provider });
    expect(result.created).toHaveLength(1);
    expect(result.sent).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("SMTP down");
  });

  it("fehlende Empfaenger-E-Mail -> skipped.noRecipient statt Fehler", async () => {
    const customerId = await makeCustomer(); // keine E-Mail
    await makeFinalizedInvoice(customerId, new Date("2051-06-01"));

    const provider = createMemoryProvider();
    const result = await runDunningJob(FIX_DATE, { orgId, provider });
    expect(result.created).toHaveLength(1);
    expect(result.sent).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped.noRecipient).toBeGreaterThanOrEqual(1);

    // Fuer die folgenden Runner-Tests: autoSend wieder aus, damit sie nicht unerwartet mailen.
    await saveDunningSettings(orgId, { autoCreate: true, autoSend: false, baseInterestRateBp: 127, baseRateValidFrom: null, gracePeriodDays: 0 });
  });

  it("S2 (Fix-Welle): heilt Altmahnungen ohne Snapshot der Org (ensureDunningSnapshots hat jetzt einen produktiven Aufrufer)", async () => {
    const customerId = await makeCustomer();
    const fin = await makeFinalizedInvoice(customerId, new Date("2051-06-01"));
    const legacy = await dbInternal.dunning.create({ data: { invoiceId: fin.id, level: 0, number: `S2-ALT-${n}` } });
    expect(legacy.snapshotSource).toBeNull();

    await runDunningJob(FIX_DATE, { orgId });

    const healed = await dbInternal.dunning.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(healed.snapshotSource).toBe("MIGRATION");
  });
});

describe("Phase 6 — runScheduledJobs (scheduler/runner.ts)", () => {
  it("Lock: junger SchedulerLock -> Job uebersprungen (skipped: locked)", async () => {
    // Fix Runde 1: der Lock ist jetzt SchedulerLock (Unique-Constraint auf `job`), nicht
    // mehr der SchedulerRun-Status. Ein RUNNING-SchedulerRun ohne passenden Lock wuerde den
    // Job NICHT mehr blockieren -- beide Zeilen gehoeren zusammen (runId verknuepft sie).
    const started = new Date("2051-06-09T09:50:00.000Z"); // 10 Min vor `now`
    const run = await dbInternal.schedulerRun.create({ data: { job: "dunning", trigger: "SCHEDULER", status: "RUNNING", startedAt: started } });
    await dbInternal.schedulerLock.create({ data: { job: "dunning", runId: run.id, lockedAt: started } });

    const results = await runScheduledJobs({ jobs: ["dunning"], trigger: "MANUAL", now: FIX_DATE });
    const dunningResult = results.find((r) => r.job === "dunning")!;
    expect(dunningResult.ok).toBe(true);
    expect(dunningResult.summary.skipped).toBe("locked");

    // Aufraeumen: Lock manuell entfernen, damit er nachfolgende Tests nicht blockiert.
    await dbInternal.schedulerLock.deleteMany({ where: { job: "dunning", runId: run.id } });
  });

  it("Lock: alter (stale) SchedulerLock -> entfernt, SchedulerRun auf FAILED gesetzt, Job laeuft trotzdem", async () => {
    const started = new Date("2051-06-09T09:00:00.000Z"); // 70 Min vor `now` -> stale (> 30 Min)
    const stale = await dbInternal.schedulerRun.create({ data: { job: "recurring", trigger: "SCHEDULER", status: "RUNNING", startedAt: started } });
    await dbInternal.schedulerLock.create({ data: { job: "recurring", runId: stale.id, lockedAt: started } });

    const results = await runScheduledJobs({ jobs: ["recurring"], trigger: "MANUAL", now: FIX_DATE });
    const recurringResult = results.find((r) => r.job === "recurring")!;
    expect(recurringResult.ok).toBe(true);
    expect(recurringResult.summary.skipped).toBeUndefined();

    const updatedStale = await dbInternal.schedulerRun.findUniqueOrThrow({ where: { id: stale.id } });
    expect(updatedStale.status).toBe("FAILED");
    expect(updatedStale.error).toBe("stale");

    // Der stale Lock wurde entfernt, sein Platz gehoert jetzt dem neuen Lauf.
    const staleLock = await dbInternal.schedulerLock.findFirst({ where: { job: "recurring", runId: stale.id } });
    expect(staleLock).toBeNull();
  });

  it("SchedulerRun-Eintraege: OK bei Erfolg", async () => {
    const before = await dbInternal.schedulerRun.count({ where: { job: "dunning", status: "OK" } });
    await runScheduledJobs({ jobs: ["dunning"], trigger: "MANUAL", now: new Date("2051-06-10T10:00:00.000Z") });
    const after = await dbInternal.schedulerRun.count({ where: { job: "dunning", status: "OK" } });
    expect(after).toBeGreaterThan(before);
  });

  it("Jobreihenfolge: recurring vor dunning vor notifications vor webhooks vor cleanup, Fehler eines Jobs bricht die anderen nicht ab", async () => {
    // Phase 8b, Task 3: Reihenfolge um den neuen Job "notifications" erweitert
    // (Task-3-Facts) — recurring -> dunning -> notifications. Phase 10, Task 5
    // (task-5-facts.md): "webhooks" laeuft danach. Fix-Welle (Should-fix 7): "cleanup"
    // laeuft als LETZTER Job.
    const now = new Date("2051-06-11T10:00:00.000Z");
    const results = await runScheduledJobs({ trigger: "MANUAL", now });
    expect(results.map((r) => r.job)).toEqual(["recurring", "dunning", "notifications", "webhooks", "cleanup"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

// Phase 7, Task 2 (§33) — RecurringInvoice.autoSend: `runDueRecurring` versendet die
// erzeugte Rechnung ueber die Standardvorlage INVOICE, Provider-Injektion analog
// `runDunningJob` (MemoryMailProvider statt echtem SMTP).
describe("Phase 7 — RecurringInvoice.autoSend (recurring/run.ts)", () => {
  const abo = { lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 };

  it("autoSend an: die erzeugte Rechnung wird per MemoryMailProvider versendet, EmailLog entsteht", async () => {
    const customerId = await makeCustomer("abo-versand@example.org");
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo mit Autoversand",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2051-07-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: true,
      autoSend: true,
      lines: [abo],
    });

    const provider = createMemoryProvider();
    // Zeitzonenfest: `nextRunDate` ist 12:00 ORTSZEIT (normalizeToNoon) — unter UTC (CI)
    // laege ein festes 10:00Z davor und das Abo waere noch nicht faellig.
    const now = rec.nextRunDate;
    const summaries = await runDueRecurring({ now, orgId, provider });
    const summary = summaries.find((s) => s.recurringId === rec.id)!;
    expect(summary.emitted).toHaveLength(1);
    expect(summary.emitted[0]!.emailStatus).toBe("SENT");
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to).toEqual(["abo-versand@example.org"]);

    const log = await dbInternal.emailLog.findFirst({ where: { orgId, docId: summary.emitted[0]!.invoiceId, status: "SENT" } });
    expect(log).not.toBeNull();
  });

  it("autoSend aus: keine E-Mail wird versendet", async () => {
    const customerId = await makeCustomer("abo-kein-versand@example.org");
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo ohne Autoversand",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2051-07-02T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: true,
      autoSend: false,
      lines: [abo],
    });

    const provider = createMemoryProvider();
    // Zeitzonenfest: `nextRunDate` ist 12:00 ORTSZEIT (normalizeToNoon) — unter UTC (CI)
    // laege ein festes 10:00Z davor und das Abo waere noch nicht faellig.
    const now = rec.nextRunDate;
    const summaries = await runDueRecurring({ now, orgId, provider });
    const summary = summaries.find((s) => s.recurringId === rec.id)!;
    expect(summary.emitted).toHaveLength(1);
    expect(summary.emitted[0]!.emailStatus).toBeUndefined();
    expect(provider.sent).toHaveLength(0);
  });

  it("autoSend an, aber Kunde ohne E-Mail -> SKIPPED, kein Fehler", async () => {
    const customerId = await makeCustomer(); // keine E-Mail
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo ohne Kunden-E-Mail",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2051-07-03T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: true,
      autoSend: true,
      lines: [abo],
    });

    const provider = createMemoryProvider();
    // Zeitzonenfest: `nextRunDate` ist 12:00 ORTSZEIT (normalizeToNoon) — unter UTC (CI)
    // laege ein festes 10:00Z davor und das Abo waere noch nicht faellig.
    const now = rec.nextRunDate;
    const summaries = await runDueRecurring({ now, orgId, provider });
    const summary = summaries.find((s) => s.recurringId === rec.id)!;
    expect(summary.emitted).toHaveLength(1);
    expect(summary.emitted[0]!.emailStatus).toBe("SKIPPED");
    expect(provider.sent).toHaveLength(0);
  });
});
