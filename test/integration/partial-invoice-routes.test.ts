/**
 * Task 4 — Routen-Tests fuer Teil-/Abschlags-/Schlussrechnungen:
 * POST /api/documents/[id]/partial-invoice, /downpayment-invoice, /final-invoice,
 * POST /api/delivery-notes/[id]/partial-invoice, GET /api/documents/[id]/billing.
 *
 * Muster: test/integration/document-route.test.ts (Route-Handler direkt aufrufen,
 * Auth/Org gemockt statt echter HTTP-Request-Kontext). Eigenes Jahr 2042 (Invoice.number
 * ist global @unique, nicht je Organisation — Testjahr-Konvention analog Task 2:
 * eigenes, anderswo unbenutztes Jahr statt des bereits vielfach belegten 2040).
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
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { POST as partialPost } from "@/app/api/documents/[id]/partial-invoice/route";
import { POST as downpaymentPost } from "@/app/api/documents/[id]/downpayment-invoice/route";
import { POST as finalPost } from "@/app/api/documents/[id]/final-invoice/route";
import { POST as deliveryNotePartialPost } from "@/app/api/delivery-notes/[id]/partial-invoice/route";
import { GET as billingGet } from "@/app/api/documents/[id]/billing/route";

const FIX_DATE = new Date("2042-07-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Routen-Teilrechnung GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

async function makeQuote(netCents = 1_000_000) {
  return createBusinessDocument(
    orgId,
    {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: netCents, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    },
    { now: FIX_DATE },
  );
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function emptyRequest(url: string): Request {
  return new Request(url, { method: "POST" });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/documents/[id]/partial-invoice", () => {
  it("201: legt eine Teilrechnung (PERCENT) an", async () => {
    const quote = await makeQuote();
    const res = await partialPost(jsonRequest(`http://localhost/api/documents/${quote.id}/partial-invoice`, { mode: "PERCENT", permille: 400 }), ctx(quote.id));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeTruthy();
    const inv = await dbInternal.invoice.findUniqueOrThrow({ where: { id: json.id } });
    expect(inv.type).toBe("PARTIAL");
    expect(inv.sourceId).toBe(quote.id);
  });

  it("400: fehlerhafter Body (mode PERCENT ohne permille)", async () => {
    const quote = await makeQuote();
    const res = await partialPost(jsonRequest(`http://localhost/api/documents/${quote.id}/partial-invoice`, { mode: "PERCENT" }), ctx(quote.id));
    expect(res.status).toBe(400);
  });

  it("409: Ueberbuchung (2x 60%)", async () => {
    const quote = await makeQuote();
    const res1 = await partialPost(jsonRequest(`http://localhost/api/documents/${quote.id}/partial-invoice`, { mode: "PERCENT", permille: 600 }), ctx(quote.id));
    expect(res1.status).toBe(201);
    const res2 = await partialPost(jsonRequest(`http://localhost/api/documents/${quote.id}/partial-invoice`, { mode: "PERCENT", permille: 600 }), ctx(quote.id));
    expect(res2.status).toBe(409);
    const json = await res2.json();
    expect(json.error).toBeTruthy();
  });

  it("404: unbekanntes Angebot", async () => {
    const res = await partialPost(jsonRequest("http://localhost/api/documents/unknown/partial-invoice", { mode: "PERCENT", permille: 400 }), ctx("unknown"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/documents/[id]/downpayment-invoice", () => {
  it("201: legt eine Abschlagsrechnung (PERCENT) an", async () => {
    const quote = await makeQuote();
    const res = await downpaymentPost(jsonRequest(`http://localhost/api/documents/${quote.id}/downpayment-invoice`, { mode: "PERCENT", permille: 300 }), ctx(quote.id));
    expect(res.status).toBe(201);
    const json = await res.json();
    const inv = await dbInternal.invoice.findUniqueOrThrow({ where: { id: json.id } });
    expect(inv.type).toBe("DOWNPAYMENT");
  });

  it("409: Mischverbot mit bestehender Teilrechnung", async () => {
    const quote = await makeQuote();
    const p = await partialPost(jsonRequest(`http://localhost/api/documents/${quote.id}/partial-invoice`, { mode: "PERCENT", permille: 300 }), ctx(quote.id));
    expect(p.status).toBe(201);
    const res = await downpaymentPost(jsonRequest(`http://localhost/api/documents/${quote.id}/downpayment-invoice`, { mode: "PERCENT", permille: 300 }), ctx(quote.id));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/documents/[id]/final-invoice", () => {
  it("201: legt eine Schlussrechnung nach einem festgeschriebenen Abschlag an", async () => {
    const quote = await makeQuote();
    const dp = await downpaymentPost(jsonRequest(`http://localhost/api/documents/${quote.id}/downpayment-invoice`, { mode: "PERCENT", permille: 300 }), ctx(quote.id));
    const dpJson = await dp.json();
    await finalizeInvoice(dpJson.id, { now: FIX_DATE });

    const res = await finalPost(emptyRequest(`http://localhost/api/documents/${quote.id}/final-invoice`), ctx(quote.id));
    expect(res.status).toBe(201);
    const json = await res.json();
    const inv = await dbInternal.invoice.findUniqueOrThrow({ where: { id: json.id } });
    expect(inv.type).toBe("FINAL");
  });

  it("409: keine Schlussrechnung ohne festgeschriebenen Abschlag", async () => {
    const quote = await makeQuote();
    const res = await finalPost(emptyRequest(`http://localhost/api/documents/${quote.id}/final-invoice`), ctx(quote.id));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/delivery-notes/[id]/partial-invoice", () => {
  it("201: Teilrechnung aus einem Lieferschein (QUANTITIES)", async () => {
    const quote = await makeQuote();
    const note = await createDeliveryNote(orgId, {
      customerId,
      sourceType: "QUOTE",
      sourceId: quote.id,
      lines: quote.lines.map((l) => ({ description: l.description, quantityMilli: l.quantityMilli, unit: l.unit, sourceType: "QUOTE", sourceId: quote.id, sourceLineId: l.id, unitNetPriceCents: l.unitNetPriceCents, taxRate: l.taxRate })),
    } as Parameters<typeof createDeliveryNote>[1]);

    const res = await deliveryNotePartialPost(
      jsonRequest(`http://localhost/api/delivery-notes/${note.id}/partial-invoice`, {
        mode: "QUANTITIES",
        quantities: [{ sourceLineId: note.lines[0].id, quantityMilli: 500 }],
      }),
      ctx(note.id),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    const inv = await dbInternal.invoice.findUniqueOrThrow({ where: { id: json.id } });
    expect(inv.type).toBe("PARTIAL");
    expect(inv.sourceType).toBe("DELIVERY_NOTE");
  });

  it("404: unbekannter Lieferschein", async () => {
    const res = await deliveryNotePartialPost(jsonRequest("http://localhost/api/delivery-notes/unknown/partial-invoice", { mode: "PERCENT", permille: 500 }), ctx("unknown"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/documents/[id]/billing", () => {
  it("200: NONE ohne Teil-/Abschlagsrechnung", async () => {
    const quote = await makeQuote();
    const res = await billingGet(new Request(`http://localhost/api/documents/${quote.id}/billing`), ctx(quote.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state).toBe("NONE");
    expect(json.lines).toHaveLength(1);
    expect(json.lines[0].remainingMilli).toBe(1000);
  });

  it("200: PARTIAL mit billedPermille nach einer 40%-Teilrechnung", async () => {
    const quote = await makeQuote();
    await partialPost(jsonRequest(`http://localhost/api/documents/${quote.id}/partial-invoice`, { mode: "PERCENT", permille: 400 }), ctx(quote.id));
    const res = await billingGet(new Request(`http://localhost/api/documents/${quote.id}/billing`), ctx(quote.id));
    const json = await res.json();
    expect(json.state).toBe("PARTIAL");
    expect(json.billedPermille).toBe(400);
  });

  it("404: unbekanntes Angebot", async () => {
    const res = await billingGet(new Request("http://localhost/api/documents/unknown/billing"), ctx("unknown"));
    expect(res.status).toBe(404);
  });
});
