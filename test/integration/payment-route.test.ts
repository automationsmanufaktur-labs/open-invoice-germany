/**
 * POST /api/invoices/[id]/payment: vorbestehende Luecke (G) — recordPayment laedt die
 * Rechnung ohne orgId-Filter, die Route pruefte den Mandanten bisher gar nicht. Muster
 * fuer den getActiveOrg()-Mock: test/integration/document-route.test.ts.
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
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { POST as paymentPost } from "@/app/api/invoices/[id]/payment/route";
import type { CreateInvoiceInput } from "@/schemas";

let ownOrgId: string;
let otherOrgId: string;
let customerId: string;
const FIX_DATE = new Date("2036-08-01T10:00:00.000Z");

beforeAll(async () => {
  const own = await dbInternal.organization.create({
    data: { legalName: "Payment Route Test GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  ownOrgId = own.id;
  const other = await dbInternal.organization.create({
    data: { legalName: "Fremde Organisation GmbH", addressLine1: "Nebenweg 2", postalCode: "20095", city: "Hamburg", vatId: "DE999999999", taxNumber: "44/999/99999" },
  });
  otherOrgId = other.id;
  const customer = await dbInternal.customer.create({
    data: { orgId: otherOrgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, ownOrgId);
  await ensureOrgMasterdata(dbInternal, otherOrgId);
  orgStore.id = ownOrgId; // die "aktive" Organisation im Test ist NICHT die Rechnungs-Org
});

function paymentReq(body: unknown) {
  return new Request("http://localhost/api/invoices/x/payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/invoices/[id]/payment — Mandanten-Pruefung (G)", () => {
  it("Rechnung einer FREMDEN Organisation -> 404, keine Zahlung wird gebucht", async () => {
    const input: CreateInvoiceInput = {
      customerId,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      documentDiscountPermille: 0,
      documentDiscountCents: 0,
      documentChargePermille: 0,
      documentChargeCents: 0,
      deliveryDate: new Date("2036-08-01"),
      lines: [
        { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ],
    } as CreateInvoiceInput;
    const draft = await createDraftInvoice(otherOrgId, input, { now: FIX_DATE });
    const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const res = await paymentPost(paymentReq({ amountCents: fin.grossTotalCents, method: "TRANSFER" }), {
      params: Promise.resolve({ id: fin.id }),
    });
    expect(res.status).toBe(404);

    const reloaded = await dbInternal.invoice.findUniqueOrThrow({ where: { id: fin.id } });
    expect(reloaded.paidAmountCents).toBe(0);
    expect(reloaded.status).toBe("FINALIZED");
  });
});
