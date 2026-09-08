/**
 * Phase 6, Task 1 — Mahnstufen-/Einstellungs-Domain + GoBD-Guard fuer Dunning.
 *
 * Eigenes Jahr fuer die Nummernvergabe (test.db wird ueber die gesamte Testlaufzeit
 * geteilt): 2045 laut Plan-Header (Testjahre je Phase-6-Testdatei).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal, prisma } from "@/lib/db";
import {
  listDunningStages,
  createDunningStage,
  updateDunningStage,
  deleteDunningStage,
  reorderDunningStages,
  DunningStageInUseError,
  DunningStageNotFoundError,
} from "@/domain/dunning/stages";
import { loadDunningSettings, saveDunningSettings, DEFAULT_DUNNING_SETTINGS } from "@/domain/dunning/settings";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";

async function makeOrg() {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Mahnwesen Test GmbH",
      addressLine1: "Teststr. 1",
      postalCode: "12345",
      city: "Berlin",
      vatId: "DE999999999",
    },
  });
  await ensureOrgMasterdata(dbInternal, org.id);
  return org.id;
}

describe("Phase 6 — Mahnstufen-Domain (stages.ts)", () => {
  it("listDunningStages liefert die vier Standardstufen, aufsteigend nach order", async () => {
    const orgId = await makeOrg();
    const stages = await listDunningStages(orgId);
    expect(stages.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(stages.every((s) => s.autoSend === false)).toBe(true);
  });

  it("createDunningStage haengt order an (max+1) und akzeptiert feeCents ab Stufe 2", async () => {
    const orgId = await makeOrg();
    const created = await createDunningStage(orgId, {
      name: "4. Mahnung",
      daysAfterDue: 14,
      newDueDays: 14,
      feeCents: 1000,
      calculateInterest: true,
      includeB2BFlatFee: true,
    });
    expect(created.order).toBe(4);
    expect(created.feeCents).toBe(1000);
  });

  it("createDunningStage lehnt feeCents > 0 auf order < 2 ab (erste zwei Stufen einer neuen Org)", async () => {
    // Neue, leere Organisation ohne DEFAULT_DUNNING_STAGES-Seed, damit order bei 0 startet.
    const org = await dbInternal.organization.create({
      data: { legalName: "Leere Org", addressLine1: "X 1", postalCode: "1", city: "X" },
    });
    await expect(
      createDunningStage(org.id, {
        name: "Stufe 0",
        daysAfterDue: 0,
        newDueDays: 14,
        feeCents: 100,
        calculateInterest: false,
        includeB2BFlatFee: false,
      }),
    ).rejects.toThrow();
  });

  it("updateDunningStage behaelt die bestehende order und wendet die feeCents-Regel darauf an", async () => {
    const orgId = await makeOrg();
    const stages = await listDunningStages(orgId);
    const stage0 = stages.find((s) => s.order === 0)!;
    const stage2 = stages.find((s) => s.order === 2)!;

    await expect(
      updateDunningStage(orgId, stage0.id, {
        name: stage0.name,
        daysAfterDue: stage0.daysAfterDue,
        newDueDays: stage0.newDueDays,
        feeCents: 500,
        calculateInterest: stage0.calculateInterest,
        includeB2BFlatFee: stage0.includeB2BFlatFee,
      }),
    ).rejects.toThrow();

    const updated = await updateDunningStage(orgId, stage2.id, {
      name: "2. Mahnung (angepasst)",
      daysAfterDue: stage2.daysAfterDue,
      newDueDays: stage2.newDueDays,
      feeCents: 750,
      calculateInterest: stage2.calculateInterest,
      includeB2BFlatFee: stage2.includeB2BFlatFee,
    });
    expect(updated.order).toBe(2);
    expect(updated.feeCents).toBe(750);
    expect(updated.name).toBe("2. Mahnung (angepasst)");
  });

  it("updateDunningStage auf unbekannte Id wirft DunningStageNotFoundError", async () => {
    const orgId = await makeOrg();
    await expect(updateDunningStage(orgId, "does-not-exist", {})).rejects.toBeInstanceOf(DunningStageNotFoundError);
  });

  it("deleteDunningStage: 409 wenn Mahnungen verknuepft, sonst geloescht", async () => {
    const orgId = await makeOrg();
    const stages = await listDunningStages(orgId);
    const stage3 = stages.find((s) => s.order === 3)!;

    // frei loeschbar, solange keine Mahnung referenziert
    await deleteDunningStage(orgId, stage3.id);
    expect(await listDunningStages(orgId)).toHaveLength(3);

    // verknuepfte Stufe: Kunde + Rechnung + Dunning-Zeile anlegen, die auf eine Stufe zeigt
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde", addressLine1: "A 1", postalCode: "1", city: "A", type: "BUSINESS" },
    });
    const invoice = await dbInternal.invoice.create({
      data: { orgId, customerId: customer.id, status: "DRAFT" },
    });
    const stage1 = (await listDunningStages(orgId)).find((s) => s.order === 1)!;
    await dbInternal.dunning.create({
      data: { invoiceId: invoice.id, level: 1, stageId: stage1.id },
    });

    await expect(deleteDunningStage(orgId, stage1.id)).rejects.toBeInstanceOf(DunningStageInUseError);
    // Stattdessen deaktivieren bleibt moeglich:
    const disabled = await updateDunningStage(orgId, stage1.id, {
      name: stage1.name,
      daysAfterDue: stage1.daysAfterDue,
      newDueDays: stage1.newDueDays,
      feeCents: stage1.feeCents,
      calculateInterest: stage1.calculateInterest,
      includeB2BFlatFee: stage1.includeB2BFlatFee,
      enabled: false,
    });
    expect(disabled.enabled).toBe(false);
  });

  it("reorderDunningStages: sechs Stufen neu sortieren (zweiphasig wegen Unique-Index)", async () => {
    const orgId = await makeOrg();
    await createDunningStage(orgId, {
      name: "4. Mahnung",
      daysAfterDue: 14,
      newDueDays: 14,
      feeCents: 0,
      calculateInterest: true,
      includeB2BFlatFee: true,
    });
    await createDunningStage(orgId, {
      name: "5. Mahnung",
      daysAfterDue: 14,
      newDueDays: 14,
      feeCents: 0,
      calculateInterest: true,
      includeB2BFlatFee: true,
    });
    const stages = await listDunningStages(orgId);
    expect(stages).toHaveLength(6);
    const reversedIds = [...stages].reverse().map((s) => s.id);

    await reorderDunningStages(orgId, { ids: reversedIds });

    const afterReorder = await listDunningStages(orgId);
    expect(afterReorder.map((s) => s.id)).toEqual(reversedIds);
    expect(afterReorder.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reorderDunningStages lehnt eine unvollstaendige/fremde Id-Liste ab", async () => {
    const orgId = await makeOrg();
    const stages = await listDunningStages(orgId);
    await expect(reorderDunningStages(orgId, { ids: [stages[0].id] })).rejects.toThrow();
    await expect(reorderDunningStages(orgId, { ids: [...stages.map((s) => s.id), "fremde-id"] })).rejects.toThrow();
  });

  // S3 (Fix-Welle): Reorder darf keine Stufe mit Mahnkosten auf order < 2 schieben (409,
  // COMPLIANCE §12) — vorher schrieb reorderDunningStages beliebige order-Werte ohne diese
  // Regel erneut zu pruefen, die Stufe war danach ueber die UI nicht mehr speicherbar.
  it("reorderDunningStages lehnt ab, wenn eine Stufe mit Mahnkosten auf order < 2 kaeme (409), und schreibt nichts", async () => {
    const orgId = await makeOrg();
    const stages = await listDunningStages(orgId);
    const stage3 = stages.find((s) => s.order === 3)!; // "3. Mahnung", feeCents 0 in den Defaults
    await updateDunningStage(orgId, stage3.id, {
      name: stage3.name,
      daysAfterDue: stage3.daysAfterDue,
      newDueDays: stage3.newDueDays,
      feeCents: 500, // jetzt mit Mahnkosten, order 3 ist erlaubt (>= 2)
      calculateInterest: stage3.calculateInterest,
      includeB2BFlatFee: stage3.includeB2BFlatFee,
      enabled: stage3.enabled,
    });

    // Stufe 3 (jetzt mit Mahnkosten) an die erste Position schieben -> order 0, verboten.
    const reordered = [stage3.id, ...stages.filter((s) => s.id !== stage3.id).map((s) => s.id)];
    await expect(reorderDunningStages(orgId, { ids: reordered })).rejects.toMatchObject({ status: 409 });

    // Nichts geschrieben: Reihenfolge unveraendert.
    const unchanged = await listDunningStages(orgId);
    expect(unchanged.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(unchanged.find((s) => s.id === stage3.id)?.order).toBe(3);
  });
});

describe("Phase 6 — Mahnwesen-Einstellungen (settings.ts)", () => {
  it("loadDunningSettings heilt sich selbst (legt Zeile mit Defaults an)", async () => {
    const orgId = await makeOrg();
    expect(await dbInternal.dunningSettings.findUnique({ where: { orgId } })).not.toBeNull(); // von ensureOrgMasterdata bereits angelegt

    const loaded = await loadDunningSettings(orgId);
    expect(loaded).toEqual(DEFAULT_DUNNING_SETTINGS);
  });

  it("loadDunningSettings legt die Zeile auch ohne vorherigen ensureOrgMasterdata-Aufruf an", async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "Ohne Ensure", addressLine1: "X 1", postalCode: "1", city: "X" },
    });
    expect(await dbInternal.dunningSettings.findUnique({ where: { orgId: org.id } })).toBeNull();
    const loaded = await loadDunningSettings(org.id);
    expect(loaded).toEqual(DEFAULT_DUNNING_SETTINGS);
    expect(await dbInternal.dunningSettings.findUnique({ where: { orgId: org.id } })).not.toBeNull();
  });

  // B2 (Fix-Welle, Bestandsschutz): eine Org mit bereits festgeschriebener Rechnung zum
  // Anlagezeitpunkt der DunningSettings-Zeile bekommt autoCreate=false, damit der
  // Scheduler nach dem ersten Start nicht sofort den kompletten Altbestand mahnt.
  it("Bestandsorg (schon eine festgeschriebene Rechnung) bekommt autoCreate=false", async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "Bestandsorg", addressLine1: "X 1", postalCode: "1", city: "X" },
    });
    const customer = await dbInternal.customer.create({
      data: { orgId: org.id, name: "Kunde", addressLine1: "A 1", postalCode: "1", city: "A", type: "BUSINESS" },
    });
    await dbInternal.invoice.create({ data: { orgId: org.id, customerId: customer.id, status: "FINALIZED" } });
    expect(await dbInternal.dunningSettings.findUnique({ where: { orgId: org.id } })).toBeNull();

    const loaded = await loadDunningSettings(org.id);
    expect(loaded.autoCreate).toBe(false);
  });

  it("neue Org ohne festgeschriebene Rechnung bekommt autoCreate=true (Default)", async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "Frische Org", addressLine1: "X 1", postalCode: "1", city: "X" },
    });
    const loaded = await loadDunningSettings(org.id);
    expect(loaded.autoCreate).toBe(true);
  });

  it("ensureOrgMasterdata: Bestandsorg (schon eine festgeschriebene Rechnung) bekommt ebenfalls autoCreate=false", async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "Bestandsorg via ensure", addressLine1: "X 1", postalCode: "1", city: "X" },
    });
    const customer = await dbInternal.customer.create({
      data: { orgId: org.id, name: "Kunde", addressLine1: "A 1", postalCode: "1", city: "A", type: "BUSINESS" },
    });
    await dbInternal.invoice.create({ data: { orgId: org.id, customerId: customer.id, status: "SENT" } });
    await ensureOrgMasterdata(dbInternal, org.id);
    const loaded = await loadDunningSettings(org.id);
    expect(loaded.autoCreate).toBe(false);
  });

  it("saveDunningSettings persistiert und rundet ISO-Datum korrekt", async () => {
    const orgId = await makeOrg();
    const saved = await saveDunningSettings(orgId, {
      autoCreate: false,
      autoSend: true,
      baseInterestRateBp: 200,
      baseRateValidFrom: "2026-07-01",
      gracePeriodDays: 5,
    });
    expect(saved.autoCreate).toBe(false);
    expect(saved.autoSend).toBe(true);
    expect(saved.baseInterestRateBp).toBe(200);
    expect(saved.baseRateValidFrom).toBe("2026-07-01");
    expect(saved.gracePeriodDays).toBe(5);

    const reloaded = await loadDunningSettings(orgId);
    expect(reloaded).toEqual(saved);
  });
});

describe("Phase 6 — GoBD-Guard fuer Dunning (src/lib/db.ts)", () => {
  let invoiceId: string;
  let dunningId: string;

  beforeAll(async () => {
    const orgId = await makeOrg();
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "Guard-Kunde", addressLine1: "A 1", postalCode: "1", city: "A", type: "BUSINESS" },
    });
    const invoice = await dbInternal.invoice.create({ data: { orgId, customerId: customer.id, status: "DRAFT" } });
    invoiceId = invoice.id;
    const dunning = await dbInternal.dunning.create({ data: { invoiceId, level: 0 } });
    dunningId = dunning.id;
  });

  it("erlaubt update auf sentAt/pdfPath ueber den geschuetzten Client", async () => {
    const updated = await prisma.dunning.update({
      where: { id: dunningId },
      data: { sentAt: new Date("2045-01-01"), pdfPath: "/tmp/mahnung.pdf" },
    });
    expect(updated.pdfPath).toBe("/tmp/mahnung.pdf");
  });

  it("verweigert update auf jedes andere Feld", async () => {
    await expect(prisma.dunning.update({ where: { id: dunningId }, data: { lateFeeCents: 999 } })).rejects.toThrow(/unveraenderlich/);
  });

  it("verweigert updateMany auf ein verbotenes Feld", async () => {
    await expect(
      prisma.dunning.updateMany({ where: { invoiceId }, data: { interestAmountCents: 1 } }),
    ).rejects.toThrow(/unveraenderlich/);
  });

  it("verweigert delete und deleteMany immer", async () => {
    await expect(prisma.dunning.delete({ where: { id: dunningId } })).rejects.toThrow(/unveraenderlich/);
    await expect(prisma.dunning.deleteMany({ where: { invoiceId } })).rejects.toThrow(/unveraenderlich/);
  });

  it("dbInternal bleibt ungeschuetzt (fuer createDunning in Task 2)", async () => {
    const updated = await dbInternal.dunning.update({ where: { id: dunningId }, data: { lateFeeCents: 4242 } });
    expect(updated.lateFeeCents).toBe(4242);
    // Aufraeumen fuer nachfolgende Tests in dieser Datei nicht noetig (eigene Org je it()).
  });
});
