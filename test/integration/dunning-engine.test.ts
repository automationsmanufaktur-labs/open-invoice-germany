/**
 * Phase 6, Task 2 — Mahn-Engine (Zeitplan, Erstellung aus Stufe, Snapshot, Status, Versand).
 * Eigenes Jahr fuer die Nummernvergabe: 2050 (Plan-Header, korrigiert). EIN gemeinsamer Org
 * fuer die gesamte Datei (wie gobd.test.ts) — `Invoice.number` ist GLOBAL eindeutig, mehrere
 * Organisationen im selben Jahr wuerden beim ersten Beleg kollidieren (Sequenz startet je
 * Org bei 1). Tests trennen sich stattdessen ueber eigene Kunden/Rechnungen; nur der Test
 * fuer "6 Stufen" erweitert die Stufenliste (ADDITIV, order 4-9) statt die Standardstufen
 * (order 0-3, von allen anderen Tests genutzt) zu veraendern.
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal, prisma } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { createDunning, DunningError } from "@/domain/dunning/create";
import { setDunningState } from "@/domain/dunning/state";
import { sendDunning } from "@/domain/dunning/send";
import { ensureDunningSnapshots } from "@/domain/dunning/snapshot";
import { createDunningStage, updateDunningStage } from "@/domain/dunning/stages";
import { saveDunningSettings } from "@/domain/dunning/settings";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { saveMailSettings } from "@/domain/email/settings";
import { createMemoryProvider } from "@/lib/mail/memory";
import { buildDunningPdfData } from "@/lib/pdf/dunning-data";
import { computeDunning } from "@/lib/dunning";
import { recordPaymentSchema, type CreateInvoiceInput } from "@/schemas";

const FIX_DATE = new Date("2050-06-09T10:00:00.000Z"); // 8 Tage nach dueDate (2050-06-01)

let orgId: string;
let n = 0;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Mahn-Engine Test GmbH", addressLine1: "Teststr. 1", postalCode: "12345", city: "Berlin", vatId: "DE999999999", taxNumber: "1" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

async function makeCustomer(type: "BUSINESS" | "CONSUMER", name?: string) {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId, name: name ?? `Kunde ${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type },
  });
  return c.id;
}

function invoiceInput(customerId: string, extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: new Date("2050-06-01"),
    dueDate: new Date("2050-06-01"),
    lines: [{ description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    ...extra,
  } as CreateInvoiceInput;
}

async function makeFinalizedInvoice(customerId: string, extra: Partial<CreateInvoiceInput> = {}) {
  const draft = await createDraftInvoice(orgId, invoiceInput(customerId, extra));
  return finalizeInvoice(draft.id, { now: FIX_DATE });
}

describe("Phase 6 — Mahn-Engine (create.ts, state.ts, send.ts, snapshot.ts)", () => {
  it("B2C: 5 Prozentpunkte Verzugszins, KEINE 40-€-Pauschale", async () => {
    const customerId = await makeCustomer("CONSUMER");
    const fin = await makeFinalizedInvoice(customerId); // brutto 238,00 €
    await createDunning(fin.id, { now: FIX_DATE }); // order 0
    const r1 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 1
    expect(r1.stage.order).toBe(1);
    expect(r1.dunning.interestAmountCents).toBeGreaterThan(0);
    expect(r1.dunning.interestRatePoints).toBe(5);
    expect(r1.dunning.flatFee40Cents).toBe(0);
  });

  it("B2B: 9 Prozentpunkte Verzugszins + 40-€-Pauschale, nur EINMAL je Forderung", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    await createDunning(fin.id, { now: FIX_DATE }); // order 0
    const r1 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 1
    expect(r1.dunning.interestRatePoints).toBe(9);
    expect(r1.dunning.flatFee40Cents).toBe(4000);
    const r2 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 2
    expect(r2.dunning.flatFee40Cents).toBe(0); // schon einmal berechnet
  });

  it("B1 (Fix-Welle): 40-€-Pauschale ueber alle vier Standardstufen genau EINMAL (0/4000/0/0), nicht nur gegen die letzte Mahnung geprueft", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    const r0 = await createDunning(fin.id, { now: FIX_DATE }); // order 0 (Zahlungserinnerung, keine Pauschale)
    const r1 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 1 (1. Mahnung)
    const r2 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 2 (2. Mahnung)
    const r3 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 3 (3. Mahnung)
    expect([r0, r1, r2, r3].map((r) => r.dunning.flatFee40Cents)).toEqual([0, 4000, 0, 0]);
  });

  it("Teilzahlung: 1.000 € Forderung, 400 € bezahlt -> Bemessungsgrundlage 600 €, Zinsen auf 600 €", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId, {
      lines: [
        { lineType: "ITEM", description: "Ware", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 84034, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ], // ~1000€ brutto
    });
    expect(fin.grossTotalCents).toBe(100000); // 1.000,00 €
    await recordPayment(fin.id, recordPaymentSchema.parse({ amountCents: 40000, method: "TRANSFER", paidAt: FIX_DATE }));

    await createDunning(fin.id, { now: FIX_DATE }); // order 0
    const r1 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 1
    expect(r1.openAmountCents).toBe(60000); // 600,00 €
    expect(r1.dunning.claimBaseCents).toBe(60000);

    const settings = await saveDunningSettings(orgId, {}); // Default-Basiszins
    const expected = computeDunning({
      openAmountCents: 60000,
      daysOverdue: r1.daysOverdue,
      isConsumer: false,
      baseRateBp: settings.baseInterestRateBp,
      applyFlatFee: false, // applyFlatFee beeinflusst nur flatFee40Cents, nicht interestCents
    });
    expect(r1.dunning.interestAmountCents).toBe(expected.interestCents);
  });

  it("6 zusaetzliche Stufen (order 4-9), die dritte davon (order 6) deaktiviert -> wird uebersprungen", async () => {
    for (let i = 0; i < 6; i++) {
      await createDunningStage(orgId, {
        name: `Zusatzstufe ${i}`,
        daysAfterDue: 1,
        newDueDays: 7,
        feeCents: 500,
        calculateInterest: true,
        includeB2BFlatFee: false,
      });
    }
    const extraStages = await dbInternal.dunningStage.findMany({ where: { orgId, order: { gte: 4 } }, orderBy: { order: "asc" } });
    expect(extraStages).toHaveLength(6);
    const third = extraStages[2]!; // order 6
    await updateDunningStage(orgId, third.id, {
      name: third.name,
      daysAfterDue: third.daysAfterDue,
      newDueDays: third.newDueDays,
      feeCents: third.feeCents,
      calculateInterest: third.calculateInterest,
      includeB2BFlatFee: third.includeB2BFlatFee,
      enabled: false,
    });

    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    for (let order = 0; order <= 3; order++) {
      await createDunning(fin.id, { now: FIX_DATE, force: true });
    }
    const r4 = await createDunning(fin.id, { now: FIX_DATE, force: true });
    expect(r4.stage.order).toBe(4);
    const r5 = await createDunning(fin.id, { now: FIX_DATE, force: true });
    expect(r5.stage.order).toBe(5);
    const r7 = await createDunning(fin.id, { now: FIX_DATE, force: true }); // order 6 ist deaktiviert -> order 7
    expect(r7.stage.order).toBe(7);
  });

  it("Stufe noch nicht faellig -> DunningError; force:true erstellt trotzdem", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    await createDunning(fin.id, { now: FIX_DATE }); // order 0, dueDate = FIX_DATE + 14 Tage
    await expect(createDunning(fin.id, { now: FIX_DATE })).rejects.toThrow(/fällig/);
    const r1 = await createDunning(fin.id, { now: FIX_DATE, force: true });
    expect(r1.stage.order).toBe(1);
  });

  it("PAUSED: Erstellung wird abgelehnt; nach Ablauf von pausedUntil wieder ACTIVE und Mahnung moeglich", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    await setDunningState(orgId, fin.id, { state: "PAUSED", pausedUntil: "2050-06-20" }, "test");

    await expect(createDunning(fin.id, { now: FIX_DATE, force: true })).rejects.toThrow(DunningError);

    const after = new Date("2050-06-21T00:00:00.000Z");
    const r = await createDunning(fin.id, { now: after, force: true });
    expect(r.stage.order).toBe(0);
    const inv = await dbInternal.invoice.findUniqueOrThrow({ where: { id: fin.id } });
    expect(inv.dunningState).toBe("ACTIVE");
    expect(inv.dunningPausedUntil).toBeNull();
  });

  it("STOPPED: Erstellung wird dauerhaft abgelehnt", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    await setDunningState(orgId, fin.id, { state: "STOPPED" }, "test");
    await expect(createDunning(fin.id, { now: FIX_DATE, force: true })).rejects.toThrow(DunningError);
  });

  it("PAID/CANCELLED: Erstellung wird abgelehnt", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    await recordPayment(fin.id, recordPaymentSchema.parse({ amountCents: fin.grossTotalCents, method: "TRANSFER", paidAt: FIX_DATE }));
    await expect(createDunning(fin.id, { now: FIX_DATE, force: true })).rejects.toThrow(/vollständig bezahlt/);
  });

  it("Mahnkosten (feeCents) sind auf Stufe 0/1 IMMER 0, auch wenn lateFeeCents uebergeben wird", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    const r0 = await createDunning(fin.id, { now: FIX_DATE, lateFeeCents: 999 });
    expect(r0.dunning.feeCents).toBe(0);
    expect(r0.dunning.lateFeeCents).toBe(0);
    const r1 = await createDunning(fin.id, { now: FIX_DATE, force: true, lateFeeCents: 999 });
    expect(r1.dunning.feeCents).toBe(0);
    expect(r1.dunning.lateFeeCents).toBe(0);
  });

  it("Snapshot friert den Kundennamen ein — spaetere Umbenennung aendert die PDF-Daten alter Mahnungen nicht", async () => {
    const customerId = await makeCustomer("BUSINESS", "Alter Kundenname AG");
    const fin = await makeFinalizedInvoice(customerId);
    const r0 = await createDunning(fin.id, { now: FIX_DATE });
    expect(r0.dunning.snapshotSource).toBe("CREATE");
    expect(r0.dunning.claimBaseCents).toBeGreaterThan(0);

    await dbInternal.customer.update({ where: { id: customerId }, data: { name: "Neuer Kundenname AG" } });

    const row = await dbInternal.dunning.findUniqueOrThrow({
      where: { id: r0.dunning.id },
      include: { invoice: { include: { org: true, customer: true } }, stage: true },
    });
    const pdfData = buildDunningPdfData(row, row.invoice);
    expect(pdfData.buyer.name).toBe("Alter Kundenname AG");
  });

  it("ensureDunningSnapshots baut Snapshots fuer Altmahnungen (snapshotSource null) mit Herkunft MIGRATION nach", async () => {
    const customerId = await makeCustomer("BUSINESS", "Migrations-Kunde");
    const fin = await makeFinalizedInvoice(customerId);
    // Alt-Mahnung ohne Snapshot direkt anlegen (dbInternal ist ungeschuetzt).
    const legacy = await dbInternal.dunning.create({ data: { invoiceId: fin.id, level: 0, number: `MA-ALT-${n}` } });
    expect(legacy.snapshotSource).toBeNull();

    const migrated = await ensureDunningSnapshots(orgId);
    expect(migrated).toBeGreaterThanOrEqual(1);

    const row = await dbInternal.dunning.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row.snapshotSource).toBe("MIGRATION");
    expect(row.sellerSnapshotJson).not.toBeNull();
    expect(row.buyerSnapshotJson).not.toBeNull();

    // Idempotent: zweiter Lauf findet nichts mehr.
    expect(await ensureDunningSnapshots(orgId)).toBe(0);
  });

  it("S2 (Fix-Welle): MIGRATION-Snapshot (nur Stammdaten nachgetragen) faellt im PDF weiterhin auf die live berechnete Restforderung zurueck, nicht auf claimBaseCents=0", async () => {
    const customerId = await makeCustomer("BUSINESS", "Live-Fallback-Kunde");
    const fin = await makeFinalizedInvoice(customerId);
    await recordPayment(fin.id, recordPaymentSchema.parse({ amountCents: 5000, method: "TRANSFER", paidAt: FIX_DATE }));
    const legacy = await dbInternal.dunning.create({ data: { invoiceId: fin.id, level: 0, number: `MA-ALT2-${n}` } });

    await ensureDunningSnapshots(orgId); // hebt snapshotSource auf MIGRATION, claimBaseCents bleibt 0
    const migrated = await dbInternal.dunning.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(migrated.snapshotSource).toBe("MIGRATION");
    expect(migrated.claimBaseCents).toBe(0);

    const row = await dbInternal.dunning.findUniqueOrThrow({
      where: { id: legacy.id },
      include: { invoice: { include: { org: true, customer: true } }, stage: true },
    });
    const pdfData = buildDunningPdfData(row, row.invoice);
    expect(pdfData.openAmountCents).toBeGreaterThan(0); // NICHT 0,00 € — live berechnet
    expect(pdfData.openAmountCents).toBe(fin.grossTotalCents - 5000);
  });

  it("sendDunning: MemoryMailProvider -> EmailLog + sentAt gesetzt, Vorlage aus stage.emailTemplateId", async () => {
    await saveMailSettings(orgId, {
      host: "localhost",
      port: 2525,
      security: "NONE",
      fromName: "Mahn-Engine Test GmbH",
      fromEmail: "rechnung@example.org",
      defaultCc: "",
      defaultBcc: "",
      copyToSelf: false,
    });
    const customerId = await makeCustomer("BUSINESS");
    await dbInternal.customer.update({ where: { id: customerId }, data: { email: "kunde@example.org" } });
    const fin = await makeFinalizedInvoice(customerId);
    const r0 = await createDunning(fin.id, { now: FIX_DATE });
    expect(r0.dunning.sentAt).toBeTruthy();

    const provider = createMemoryProvider();
    const result = await sendDunning(orgId, r0.dunning.id, { actor: "test", provider });
    expect(result.status).toBe("SENT");
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to).toEqual(["kunde@example.org"]);

    const updated = await dbInternal.dunning.findUniqueOrThrow({ where: { id: r0.dunning.id } });
    expect(updated.sentAt.getTime()).toBeGreaterThan(0);

    const log = await dbInternal.emailLog.findFirst({ where: { orgId, docId: r0.dunning.id, docType: "DUNNING" } });
    expect(log).not.toBeNull();
    expect(log?.status).toBe("SENT");

    const changeLog = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "INVOICE", entityId: fin.id, action: "DUNNING_SEND" } });
    expect(changeLog).not.toBeNull();
  });

  it("Guard: dunning.update ueber den geschuetzten Client verweigert alles ausser sentAt/pdfPath", async () => {
    const customerId = await makeCustomer("BUSINESS");
    const fin = await makeFinalizedInvoice(customerId);
    const r0 = await createDunning(fin.id, { now: FIX_DATE });
    await expect(prisma.dunning.update({ where: { id: r0.dunning.id }, data: { interestAmountCents: 1 } })).rejects.toThrow(/unveraenderlich/);
  });
});
