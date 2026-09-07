/**
 * Phase 6, Task 4 — Routen-Tests: Mahnstufen-CRUD/Reorder, Mahnwesen-Einstellungen,
 * Mahnung erstellen (force/409), Mahnprozess-Status, Mahnversand-Route, Uebersicht
 * (Aging-Buckets). Muster: test/integration/partial-invoice-routes.test.ts (Route-Handler
 * direkt aufrufen, Auth/Org gemockt). Eigenes Jahr 2052 (Testjahr-Konvention, plan-header.md).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "tester",
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createDunning } from "@/domain/dunning/create";
import type { CreateInvoiceInput } from "@/schemas";

import { GET as stagesGet, POST as stagesPost } from "@/app/api/dunning-stages/route";
import { PATCH as stagePatch, DELETE as stageDelete } from "@/app/api/dunning-stages/[id]/route";
import { POST as reorderPost } from "@/app/api/dunning-stages/reorder/route";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/dunning-settings/route";
import { POST as dunningPost } from "@/app/api/invoices/[id]/dunning/route";
import { POST as dunningStatePost } from "@/app/api/invoices/[id]/dunning-state/route";
import { POST as dunningSendPost } from "@/app/api/dunnings/[id]/send/route";
import { GET as overviewGet } from "@/app/api/dunning/overview/route";

const FIX_DATE = new Date("2052-09-01T10:00:00.000Z");

let orgId: string;
let n = 0;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Routen-Mahnwesen GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
});

async function makeCustomer(type: "BUSINESS" | "CONSUMER" = "BUSINESS") {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId, name: `Kunde ${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type },
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
    lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 50000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
  } as CreateInvoiceInput;
}

// Die Routen (POST .../dunning, GET .../overview) verwenden intern das ECHTE "jetzt"
// (kein now-Override ueber die HTTP-Schnittstelle) — Faelligkeit/Ueberfaelligkeit muss
// daher relativ zur echten Systemzeit gesetzt werden, nicht relativ zu FIX_DATE (2052,
// nur fuer die Nummernkreis-Isolierung beim Festschreiben). 2h Puffer gegen Rundung.
async function makeOverdueInvoice(daysOverdue: number, type: "BUSINESS" | "CONSUMER" = "BUSINESS") {
  const customerId = await makeCustomer(type);
  const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000);
  const draft = await createDraftInvoice(orgId, invoiceInput(customerId, dueDate));
  return finalizeInvoice(draft.id, { now: FIX_DATE });
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function emptyRequest(url: string, method = "POST"): Request {
  return new Request(url, { method });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Mahnstufen-Routen (/api/dunning-stages)", () => {
  it("GET liefert die vier Standardstufen", async () => {
    const res = await stagesGet();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.stages.length).toBeGreaterThanOrEqual(4);
  });

  it("POST 201: legt eine neue Stufe an (order = max+1, feeCents erlaubt ab order >= 2)", async () => {
    const res = await stagesPost(
      jsonRequest("http://x/api/dunning-stages", {
        name: "4. Mahnung",
        daysAfterDue: 14,
        newDueDays: 14,
        feeCents: 500,
        calculateInterest: true,
        includeB2BFlatFee: false,
        enabled: true,
      }),
    );
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(j.stage.order).toBeGreaterThanOrEqual(4);
    expect(j.stage.feeCents).toBe(500);
  });

  it("POST 400: Validierung fehlgeschlagen bei fehlendem Namen", async () => {
    const res = await stagesPost(jsonRequest("http://x/api/dunning-stages", { name: "", daysAfterDue: 1, newDueDays: 14, feeCents: 0, calculateInterest: false, includeB2BFlatFee: false }));
    expect(res.status).toBe(400);
  });

  it("PATCH 400: feeCents > 0 auf Stufe order 0 (COMPLIANCE §12)", async () => {
    const list = await (await stagesGet()).json();
    const stage0 = list.stages.find((s: { order: number }) => s.order === 0);
    const res = await stagePatch(
      jsonRequest("http://x", { name: stage0.name, daysAfterDue: stage0.daysAfterDue, newDueDays: stage0.newDueDays, feeCents: 10, calculateInterest: stage0.calculateInterest, includeB2BFlatFee: stage0.includeB2BFlatFee, enabled: stage0.enabled }),
      ctx(stage0.id),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH 200: aktualisiert eine bestehende Stufe", async () => {
    const list = await (await stagesGet()).json();
    const stage0 = list.stages.find((s: { order: number }) => s.order === 0);
    const res = await stagePatch(
      jsonRequest("http://x", { name: "Erinnerung (angepasst)", daysAfterDue: 5, newDueDays: 10, feeCents: 0, calculateInterest: false, includeB2BFlatFee: false, enabled: true }),
      ctx(stage0.id),
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.stage.name).toBe("Erinnerung (angepasst)");
  });

  it("PATCH 404: unbekannte Stufen-Id", async () => {
    const res = await stagePatch(jsonRequest("http://x", { name: "x", daysAfterDue: 1, newDueDays: 14, feeCents: 0, calculateInterest: false, includeB2BFlatFee: false }), ctx("unknown-id"));
    expect(res.status).toBe(404);
  });

  it("DELETE 409: Stufe mit bestehenden Mahnungen kann nicht geloescht werden", async () => {
    const fin = await makeOverdueInvoice(30);
    const res0 = await createDunning(fin.id, { now: FIX_DATE, force: true });
    const res = await stageDelete(emptyRequest("http://x", "DELETE"), ctx(res0.stage.id));
    expect(res.status).toBe(409);
  });

  it("DELETE 200: unbenutzte Stufe kann geloescht werden", async () => {
    const created = await stagesPost(
      jsonRequest("http://x/api/dunning-stages", { name: "Wegwerf-Stufe", daysAfterDue: 1, newDueDays: 14, feeCents: 0, calculateInterest: false, includeB2BFlatFee: false }),
    );
    const stage = (await created.json()).stage;
    const res = await stageDelete(emptyRequest("http://x", "DELETE"), ctx(stage.id));
    expect(res.status).toBe(200);
  });

  it("DELETE 404: unbekannte Id", async () => {
    const res = await stageDelete(emptyRequest("http://x", "DELETE"), ctx("unknown-id"));
    expect(res.status).toBe(404);
  });

  it("POST /reorder 200: kehrt die Reihenfolge der gebuehrenfreien ersten beiden Stufen um", async () => {
    // S3 (Fix-Welle): ein VOLLES Reverse aller Stufen wuerde die zuvor angelegte "4. Mahnung"
    // (feeCents 500) auf order 0 schieben — jetzt korrekt 409 (siehe eigener Test unten).
    // Dieser Test bleibt bei einem Swap, der die Gebuehrenregel nicht verletzt (order 0/1,
    // beide feeCents 0), um den Grundfall (Reorder funktioniert) weiterhin abzudecken.
    const list = await (await stagesGet()).json();
    const stage0 = list.stages.find((s: { order: number }) => s.order === 0);
    const stage1 = list.stages.find((s: { order: number }) => s.order === 1);
    const rest = list.stages.filter((s: { id: string }) => s.id !== stage0.id && s.id !== stage1.id).map((s: { id: string }) => s.id);
    const ids = [stage1.id, stage0.id, ...rest];
    const res = await reorderPost(jsonRequest("http://x/api/dunning-stages/reorder", { ids }));
    expect(res.status).toBe(200);
  });

  it("POST /reorder 409: eine Stufe mit Mahnkosten darf nicht auf order < 2 wandern (COMPLIANCE §12)", async () => {
    const list = await (await stagesGet()).json();
    const ids = list.stages.map((s: { id: string }) => s.id).reverse(); // "4. Mahnung" (feeCents 500) landet auf order 0
    const res = await reorderPost(jsonRequest("http://x/api/dunning-stages/reorder", { ids }));
    expect(res.status).toBe(409);
  });

  it("POST /reorder 400: unvollstaendige Id-Liste", async () => {
    const res = await reorderPost(jsonRequest("http://x/api/dunning-stages/reorder", { ids: ["nur-eine-id"] }));
    expect(res.status).toBe(400);
  });
});

describe("Mahnwesen-Einstellungen (/api/dunning-settings)", () => {
  it("GET liefert Defaults (Selbstheilung)", async () => {
    const res = await settingsGet();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.autoSend).toBe(false);
  });

  it("PUT 200: speichert geaenderte Einstellungen", async () => {
    const res = await settingsPut(jsonRequest("http://x", { autoCreate: true, autoSend: true, baseInterestRateBp: 200, gracePeriodDays: 5 }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.baseInterestRateBp).toBe(200);
    expect(j.settings.autoSend).toBe(true);
    // zurueck auf Default, damit nachfolgende Tests (auto-create Erwartung) nicht beeinflusst werden
    await settingsPut(jsonRequest("http://x", { autoCreate: true, autoSend: false, baseInterestRateBp: 127, gracePeriodDays: 0 }));
  });

  it("PUT 400: baseInterestRateBp ausserhalb der Grenzen", async () => {
    const res = await settingsPut(jsonRequest("http://x", { baseInterestRateBp: 99999 }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/invoices/[id]/dunning", () => {
  it("409: naechste Stufe noch nicht faellig ohne force", async () => {
    const fin = await makeOverdueInvoice(0);
    const res = await dunningPost(emptyRequest("http://x"), ctx(fin.id));
    expect(res.status).toBe(409);
  });

  it("200 mit force: erzwingt die Erstellung, liefert stage/level", async () => {
    const fin = await makeOverdueInvoice(1);
    const res = await dunningPost(jsonRequest("http://x", { force: true }), ctx(fin.id));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.stage.order).toBe(0);
  });

  it("400: ungueltiger Body (lateFeeCents negativ)", async () => {
    const fin = await makeOverdueInvoice(30);
    const res = await dunningPost(jsonRequest("http://x", { force: true, lateFeeCents: -5 }), ctx(fin.id));
    expect(res.status).toBe(400);
  });

  it("404: unbekannte Rechnung (nicht der aktiven Organisation zugehoerig)", async () => {
    const res = await dunningPost(emptyRequest("http://x"), ctx("unbekannt"));
    expect(res.status).toBe(404);
  });

  it("positiver feeCents-Fluss: Stufe order >= 2 traegt Mahnkosten in claimBase-unabhaengiger Summe", async () => {
    const created = await stagesPost(
      jsonRequest("http://x/api/dunning-stages", { name: "Kostenpflichtige Stufe", daysAfterDue: 0, newDueDays: 14, feeCents: 750, calculateInterest: false, includeB2BFlatFee: false }),
    );
    const stage = (await created.json()).stage;
    expect(stage.order).toBeGreaterThanOrEqual(2);

    const fin = await makeOverdueInvoice(60);
    // Alle Stufen bis zur neuen kostenpflichtigen Stufe durchlaufen (force, da nicht faellig).
    let lastStageOrder = -1;
    for (let i = 0; i <= stage.order; i++) {
      const res = await dunningPost(jsonRequest("http://x", { force: true }), ctx(fin.id));
      const j = await res.json();
      expect(res.status).toBe(200);
      lastStageOrder = j.stage.order;
    }
    expect(lastStageOrder).toBe(stage.order);
    const last = await dbInternal.dunning.findFirst({ where: { invoiceId: fin.id, stageId: stage.id } });
    expect(last?.feeCents).toBe(750);
  });
});

describe("POST /api/invoices/[id]/dunning-state", () => {
  it("200: pausiert den Mahnprozess mit Datum", async () => {
    const fin = await makeOverdueInvoice(5);
    const res = await dunningStatePost(jsonRequest("http://x", { state: "PAUSED", pausedUntil: "2052-12-31", note: "Ratenzahlung" }), ctx(fin.id));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.state).toBe("PAUSED");
  });

  it("400: pausedUntil bei state=ACTIVE ist ungueltig", async () => {
    const fin = await makeOverdueInvoice(5);
    const res = await dunningStatePost(jsonRequest("http://x", { state: "ACTIVE", pausedUntil: "2052-12-31" }), ctx(fin.id));
    expect(res.status).toBe(400);
  });

  it("409: unbekannte Rechnung", async () => {
    const res = await dunningStatePost(jsonRequest("http://x", { state: "STOPPED" }), ctx("unbekannt"));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/dunnings/[id]/send", () => {
  it("409: unbekannte Mahnung", async () => {
    const res = await dunningSendPost(emptyRequest("http://x"), ctx("unbekannt"));
    expect(res.status).toBe(409);
  });

  it("409: MAIL_NOT_CONFIGURED, da keine Mail-Einstellungen hinterlegt sind", async () => {
    const fin = await makeOverdueInvoice(20);
    const d = await createDunning(fin.id, { now: FIX_DATE, force: true });
    const res = await dunningSendPost(emptyRequest("http://x"), ctx(d.dunning.id));
    const j = await res.json();
    expect(res.status).toBe(409);
    expect(j.error).toBe("MAIL_NOT_CONFIGURED");
  });
});

describe("GET /api/dunning/overview", () => {
  let inv3: Awaited<ReturnType<typeof makeOverdueInvoice>>;
  let inv20: Awaited<ReturnType<typeof makeOverdueInvoice>>;
  let inv45: Awaited<ReturnType<typeof makeOverdueInvoice>>;
  let inv90: Awaited<ReturnType<typeof makeOverdueInvoice>>;

  beforeAll(async () => {
    inv3 = await makeOverdueInvoice(3);
    inv20 = await makeOverdueInvoice(20);
    inv45 = await makeOverdueInvoice(45);
    inv90 = await makeOverdueInvoice(90);
  });

  it("liefert Aging-Buckets fuer 4 Rechnungen (3/20/45/90 Tage ueberfaellig)", async () => {
    const res = await overviewGet(new Request("http://x/api/dunning/overview"));
    const j = await res.json();
    expect(res.status).toBe(200);

    const ids = [inv3.id, inv20.id, inv45.id, inv90.id];
    expect(ids.every((id: string) => j.rows.some((r: { invoiceId: string }) => r.invoiceId === id))).toBe(true);

    expect(j.widgets.aging.d1_7.count).toBeGreaterThanOrEqual(1);
    expect(j.widgets.aging.d8_30.count).toBeGreaterThanOrEqual(1);
    expect(j.widgets.aging.d31_60.count).toBeGreaterThanOrEqual(1);
    expect(j.widgets.aging.d60plus.count).toBeGreaterThanOrEqual(1);

    // sortiert nach daysOverdue absteigend
    const idxOf = (id: string) => j.rows.findIndex((r: { invoiceId: string }) => r.invoiceId === id);
    expect(idxOf(inv90.id)).toBeLessThan(idxOf(inv45.id));
    expect(idxOf(inv45.id)).toBeLessThan(idxOf(inv20.id));
    expect(idxOf(inv20.id)).toBeLessThan(idxOf(inv3.id));
  });

  it("filtert nach customerId", async () => {
    const res = await overviewGet(new Request(`http://x/api/dunning/overview?customerId=${inv90.customerId}`));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.rows.every((r: { invoiceId: string }) => r.invoiceId === inv90.id)).toBe(true);
  });

  it("400: ungueltiger stageOrder-Filter", async () => {
    const res = await overviewGet(new Request("http://x/api/dunning/overview?stageOrder=nichtnumerisch"));
    expect(res.status).toBe(400);
  });

  it("Nit (Fix-Welle): heute faellig (daysOverdue=0) faellt aus dem '1-7 Tage'-Bucket, zaehlt aber weiter in overdueCount", async () => {
    const before = await overviewGet(new Request("http://x/api/dunning/overview"));
    const jBefore = await before.json();
    const bucketBefore = jBefore.widgets.aging.d1_7.count;
    const overdueBefore = jBefore.widgets.overdueCount;

    const invToday = await makeOverdueInvoice(0);

    const after = await overviewGet(new Request("http://x/api/dunning/overview"));
    const jAfter = await after.json();
    expect(jAfter.widgets.aging.d1_7.count).toBe(bucketBefore); // NICHT erhoeht
    expect(jAfter.widgets.overdueCount).toBe(overdueBefore + 1); // trotzdem in overdueCount
    expect(jAfter.rows.some((r: { invoiceId: string }) => r.invoiceId === invToday.id)).toBe(true);
  });

  it("S2 (Fix-Welle): GET /api/dunning/overview heilt Altmahnungen ohne Snapshot der Org (ensureDunningSnapshots)", async () => {
    const legacy = await dbInternal.dunning.create({ data: { invoiceId: inv3.id, level: 0, number: `OVW-ALT-${inv3.id}` } });
    expect(legacy.snapshotSource).toBeNull();

    const res = await overviewGet(new Request("http://x/api/dunning/overview"));
    expect(res.status).toBe(200);

    const healed = await dbInternal.dunning.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(healed.snapshotSource).toBe("MIGRATION");
  });

  // Fix-Welle (S7, Nit): daysOverdue (row-Feld) rechnete vorher rohe Millisekunden-
  // Elapsed statt kalendertaggenau (UTC) wie agingBuckets() — eine Rechnung, deren
  // dueDate GESTERN (UTC) lag, `now` aber erst 2h spaeter (UTC-Mitternacht dazwischen)
  // konnte gleichzeitig daysOverdue=0 zeigen UND im "1-7 Tage"-Bucket landen. Mit
  // injiziertem `now` (loadDunningOverview direkt statt der Route, die nur die echte
  // Systemzeit kennt) laesst sich das deterministisch nachstellen.
  it("Nit (Fix-Welle): daysOverdue ist kalendertaggenau (UTC) konsistent mit dem Aging-Bucket", async () => {
    const { loadDunningOverview } = await import("@/domain/dunning/overview");

    const dueDateYesterday = new Date("2052-09-10T23:00:00.000Z"); // gestern (UTC), 23 Uhr
    const nowJustAfterMidnight = new Date("2052-09-11T01:00:00.000Z"); // heute (UTC), 2h spaeter

    const customerId = await makeCustomer("BUSINESS");
    const draft = await createDraftInvoice(orgId, invoiceInput(customerId, dueDateYesterday));
    const invoice = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const overview = await loadDunningOverview(orgId, nowJustAfterMidnight);
    const row = overview.rows.find((r) => r.invoiceId === invoice.id);
    expect(row).toBeDefined();
    // Kalendertag-Differenz UTC: 2052-09-11 minus 2052-09-10 = 1 Tag, NICHT 0 (wie es der
    // rohe Millisekunden-Elapsed — nur 2 Stunden — vorher errechnet haette).
    expect(row!.daysOverdue).toBe(1);
    expect(overview.widgets.aging.d1_7.count).toBeGreaterThanOrEqual(1);
  });
});
