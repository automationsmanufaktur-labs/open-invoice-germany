/**
 * Fix-Runde 1 (Task 2, MEDIUM): POST /api/invoices/[id]/duplicate mappt
 * InvalidOperationError (Duplizieren einer PARTIAL/DOWNPAYMENT/FINAL-Rechnung) auf 409.
 * Muster: test/integration/invoice-route.test.ts (Route-Handler direkt aufrufen, Auth/Org
 * gemockt statt echter HTTP-Request-Kontext).
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
import { createPartialInvoice } from "@/domain/invoice/partial";
import { POST } from "@/app/api/invoices/[id]/duplicate/route";

const FIX_DATE = new Date("2040-06-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Duplicate-Route GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

function postRequest(id: string): Request {
  return new Request(`http://localhost/api/invoices/${id}/duplicate`, { method: "POST" });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/invoices/[id]/duplicate", () => {
  it("409: eine PARTIAL-Rechnung kann nicht dupliziert werden", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 100_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
      },
      { now: FIX_DATE },
    );
    const partial = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE });

    const res = await POST(postRequest(partial.id), ctx(partial.id));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/PARTIAL/);
  });

  it("404: unbekannte Rechnung", async () => {
    const res = await POST(postRequest("unknown-id"), ctx("unknown-id"));
    expect(res.status).toBe(404);
  });
});
