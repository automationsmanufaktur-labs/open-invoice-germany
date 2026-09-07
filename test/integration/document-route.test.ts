/**
 * Task-3-Ergaenzung (Fix-Runde 2, W5): Routen-Tests fuer die Status-/Konvertierungs-
 * Routen unter /api/documents/[id]. Muster: test/integration/email-route.test.ts
 * (Route-Handler direkt aufrufen, Auth/Org gemockt statt echter HTTP-Request-Kontext).
 *
 * getActiveOrg() liest aus dbInternal.organization.findFirst({orderBy: createdAt asc})
 * — in der geteilten Test-DB dieses Laufs waere das nicht zuverlaessig die eigene
 * Organisation dieses Tests. Deshalb wird @/lib/org gemockt und liefert die in
 * beforeAll angelegte Organisation ueber einen (vi.hoisted) Store.
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
import { setQuoteStatus } from "@/domain/document/status";
import { POST as statusPost } from "@/app/api/documents/[id]/status/route";
import { POST as convertPost } from "@/app/api/documents/[id]/convert/route";

const FIX_DATE = new Date("2033-03-01T10:00:00.000Z");
const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

let orgId: string;
let customerId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Route Test GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

async function createQuote() {
  return createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
}

function statusReq(action: string, note?: string) {
  return new Request("http://localhost/api/documents/x/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, note }),
  });
}

function convertReq(body: unknown) {
  return new Request("http://localhost/api/documents/x/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/documents/[id]/status", () => {
  it("MARK_CREATED auf ein Angebot -> 400 (unpassende Aktion, G3)", async () => {
    const quote = await createQuote();
    const res = await statusPost(statusReq("MARK_CREATED"), { params: Promise.resolve({ id: quote.id }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/nicht gueltig/);
  });

  it("unbekannte ID -> 404 (NotFoundError)", async () => {
    const res = await statusPost(statusReq("MARK_SENT"), { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });

  it("verbotener Uebergang -> 409 (StatusTransitionError)", async () => {
    const quote = await createQuote();
    await setQuoteStatus(orgId, quote.id, "REJECTED", { now: FIX_DATE });
    const res = await statusPost(statusReq("MARK_SENT"), { params: Promise.resolve({ id: quote.id }) });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/documents/[id]/convert", () => {
  it("ohne Body -> INVOICE (Rueckwaertskompatibilitaet ConvertButton)", async () => {
    const quote = await createQuote();
    const res = await convertPost(new Request("http://localhost/api/documents/x/convert", { method: "POST" }), { params: Promise.resolve({ id: quote.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe("INVOICE");
    expect(json.invoiceId).toBe(json.id);
  });

  it("leerer Body ({}) -> ebenfalls INVOICE", async () => {
    const quote = await createQuote();
    const res = await convertPost(convertReq({}), { params: Promise.resolve({ id: quote.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe("INVOICE");
  });
});
