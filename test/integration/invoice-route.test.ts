/**
 * Fix-Runde 1 zu Task 5: Routen-Test fuer PATCH /api/invoices/[id]. Muster:
 * test/integration/document-route.test.ts (Route-Handler direkt aufrufen, Auth/Org
 * gemockt statt echter HTTP-Request-Kontext — getActiveOrg() liest sonst unzuverlaessig
 * aus der geteilten Test-DB).
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
import { createInvoiceSchema } from "@/schemas";
import { PATCH } from "@/app/api/invoices/[id]/route";

const FIX_DATE = new Date("2037-05-01T10:00:00.000Z");

let orgId: string;
let otherOrgId: string;
let customerId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Invoice-Route GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);

  const other = await dbInternal.organization.create({ data: { legalName: "Fremde GmbH", addressLine1: "X", postalCode: "1", city: "X" } });
  otherOrgId = other.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

async function draftInvoice() {
  return createDraftInvoice(
    orgId,
    createInvoiceSchema.parse({
      customerId,
      lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }],
    }),
    { now: FIX_DATE },
  );
}

function patchRequest(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/invoices/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/invoices/[id]", () => {
  it("200: aktualisiert einen Entwurf", async () => {
    const invoice = await draftInvoice();
    const res = await PATCH(patchRequest(invoice.id, { subject: "Neuer Betreff" }), ctx(invoice.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(invoice.id);
    expect(json.status).toBe("DRAFT");

    const reloaded = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.subject).toBe("Neuer Betreff");
  });

  it("409: festgeschriebene Rechnung darf nicht bearbeitet werden", async () => {
    const invoice = await draftInvoice();
    await dbInternal.invoice.update({ where: { id: invoice.id }, data: { status: "FINALIZED", number: `TEST-${invoice.id}` } });

    const res = await PATCH(patchRequest(invoice.id, { subject: "Sollte scheitern" }), ctx(invoice.id));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/DRAFT/);
  });

  it("404: unbekannte oder fremde Rechnung", async () => {
    const invoice = await draftInvoice();

    const resUnknown = await PATCH(patchRequest("unbekannt", { subject: "x" }), ctx("unbekannt"));
    expect(resUnknown.status).toBe(404);

    // Aus Sicht einer FREMDEN Org existiert die Rechnung nicht.
    orgStore.id = otherOrgId;
    const resForeign = await PATCH(patchRequest(invoice.id, { subject: "x" }), ctx(invoice.id));
    expect(resForeign.status).toBe(404);
    orgStore.id = orgId;
  });

  it("400: Validierungsfehler (Zod)", async () => {
    const invoice = await draftInvoice();
    const res = await PATCH(patchRequest(invoice.id, { lines: [] }), ctx(invoice.id));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validierung fehlgeschlagen");
  });

  it("ignoriert ein mitgesendetes type-Feld (updateInvoiceSchema.omit)", async () => {
    const invoice = await draftInvoice();
    expect(invoice.type).toBe("INVOICE");

    const res = await PATCH(patchRequest(invoice.id, { type: "CREDIT_NOTE", subject: "Trotzdem aktualisiert" }), ctx(invoice.id));
    expect(res.status).toBe(200);

    const reloaded = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.type).toBe("INVOICE");
    expect(reloaded.subject).toBe("Trotzdem aktualisiert");
  });
});
