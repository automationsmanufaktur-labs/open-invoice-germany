/**
 * saveCustomer (src/app/actions/masterdata.ts): vorbestehende Luecke (G) — die Server-
 * Action schrieb defaultPaymentMethodId ungeprueft, eine Zahlungsmethode einer FREMDEN
 * Organisation liess sich eintragen (Prisma prueft nur Existenz der ID, nicht orgId).
 * Muster fuer den getActiveOrg()-Mock: test/integration/document-route.test.ts.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { saveCustomer } from "@/app/actions/masterdata";

let ownOrgId: string;
let otherOrgId: string;
let otherOrgMethodId: string;

beforeAll(async () => {
  const own = await dbInternal.organization.create({
    data: { legalName: "SaveCustomer Test GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  ownOrgId = own.id;
  const other = await dbInternal.organization.create({
    data: { legalName: "Fremde Organisation 2 GmbH", addressLine1: "Nebenweg 2", postalCode: "20095", city: "Hamburg", vatId: "DE999999998", taxNumber: "44/999/99998" },
  });
  otherOrgId = other.id;
  await ensureOrgMasterdata(dbInternal, ownOrgId);
  await ensureOrgMasterdata(dbInternal, otherOrgId);
  const otherMethod = await dbInternal.paymentMethod.findFirstOrThrow({ where: { orgId: otherOrgId, code: "TRANSFER" } });
  otherOrgMethodId = otherMethod.id;
  orgStore.id = ownOrgId;
});

function customerForm(defaultPaymentMethodId: string): FormData {
  const fd = new FormData();
  fd.set("type", "BUSINESS");
  fd.set("name", "Testkunde");
  fd.set("addressLine1", "Weg 1");
  fd.set("postalCode", "12345");
  fd.set("city", "Berlin");
  fd.set("countryCode", "DE");
  fd.set("defaultPaymentTermsDays", "14");
  fd.set("defaultPaymentMethodId", defaultPaymentMethodId);
  return fd;
}

describe("saveCustomer — Mandanten-Pruefung fuer defaultPaymentMethodId (G)", () => {
  it("Zahlungsmethode einer FREMDEN Organisation wird abgelehnt", async () => {
    const result = await saveCustomer({ ok: false }, customerForm(otherOrgMethodId));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Zahlungsmethode/);
  });
});
