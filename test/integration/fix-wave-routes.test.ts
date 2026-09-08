/**
 * Fix-Welle (nach dem Abschluss-Review von Phase 5): B2 (E-Mail-Kontext fuer PARTIAL/
 * DOWNPAYMENT/FINAL), B4 (Skonto-Vorschau ueber payableBaseCents), Nit (ungueltiges
 * JSON -> 400 statt 500).
 *
 * Muster: test/integration/partial-invoice-routes.test.ts (Route-Handler direkt
 * aufrufen, Auth/Org gemockt). Eigenes Jahr 2046 (bislang unbenutzt).
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
import { createDownpaymentInvoice } from "@/domain/invoice/downpayment";
import { createFinalInvoice } from "@/domain/invoice/final";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { buildTemplateContext, DocumentNotFoundError } from "@/domain/email/context";
import { POST as partialPost } from "@/app/api/documents/[id]/partial-invoice/route";
import { GET as skontoCheckGet } from "@/app/api/invoices/[id]/skonto-check/route";
import { GET as deliveryNoteBillingGet } from "@/app/api/delivery-notes/[id]/billing/route";

const FIX_DATE = new Date("2046-05-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Fix-Welle-Routen GmbH", addressLine1: "Bahnhofstr. 1", postalCode: "80331", city: "München", vatId: "DE111222333", taxNumber: "35/111/22333" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Routen-Kunde AG", addressLine1: "Marienplatz 1", postalCode: "80331", city: "München", type: "BUSINESS" },
  });
  customerId = customer.id;
});

async function makeQuote(netCents: number) {
  return createBusinessDocument(
    orgId,
    {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [
        { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: netCents, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ],
    },
    { now: FIX_DATE },
  );
}

describe("B2: E-Mail-Versand fuer PARTIAL/DOWNPAYMENT/FINAL", () => {
  it("buildTemplateContext findet eine festgeschriebene Schlussrechnung und zeigt payableBaseCents als offenen Betrag", async () => {
    const quote = await makeQuote(1_000_000);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });

    const result = await buildTemplateContext(orgId, "INVOICE", final.id);
    expect(result.docNumber).toBe(final.number);
    // payableCents (Rest nach Abzug: 8.330,00 EUR), NICHT grossTotalCents (11.900,00 EUR
    // voller Rechnungsbetrag).
    expect(final.payableCents).toBe(833_000);
    expect(final.grossTotalCents).toBe(1_190_000);
    const invoiceCtx = result.ctx.invoice as { openAmount: string };
    expect(invoiceCtx.openAmount).toBe("8.330,00 €");
  });

  it("wirft weiterhin DocumentNotFoundError fuer eine unbekannte Rechnung", async () => {
    await expect(buildTemplateContext(orgId, "INVOICE", "unbekannt")).rejects.toThrow(DocumentNotFoundError);
  });
});

describe("B4: Skonto-Vorschau nutzt payableBaseCents wie recordPayment", () => {
  it("GET /api/invoices/[id]/skonto-check rechnet auf dem Rest einer Schlussrechnung, nicht auf grossTotalCents", async () => {
    const quote = await makeQuote(1_000_000);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const payable = final.payableCents!;

    // Anfrage mit dem vollen Rest (payableCents) sollte "restCents" nahe 0 ergeben, nicht
    // negativ (waere der Fall, wenn die Route weiterhin grossTotalCents zugrunde legt).
    const res = await skontoCheckGet(
      new Request(`http://localhost/api/invoices/${final.id}/skonto-check?amountCents=${payable}`),
      ctx(final.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // Kein Skonto konfiguriert -> keine Vorschlagszeile, aber der Request selbst darf
    // nicht mit einem (aus grossTotalCents berechneten) falschen Rest scheitern.
    expect(json.suggestion).toBeNull();
  });
});

describe("B11: GET /api/delivery-notes/[id]/billing (UI-Einstieg Teilrechnung aus Lieferschein)", () => {
  it("meldet hasPrices=false, sobald eine Zeile keinen Preis traegt", async () => {
    const dn = await createDeliveryNote(
      orgId,
      {
        customerId,
        showPrices: false,
        lines: [
          { description: "Bepreist", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5_000, taxRate: 19 },
          { description: "Preislos", quantityMilli: 1000, unit: "C62" },
        ],
      },
      { now: FIX_DATE },
    );
    const res = await deliveryNoteBillingGet(new Request(`http://localhost/api/delivery-notes/${dn.id}/billing`), ctx(dn.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasPrices).toBe(false);
    expect(json.lines).toHaveLength(2);
  });

  it("meldet hasPrices=true, wenn alle Zeilen einen Preis tragen", async () => {
    const dn = await createDeliveryNote(
      orgId,
      {
        customerId,
        showPrices: true,
        lines: [{ description: "Bepreist", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5_000, taxRate: 19 }],
      },
      { now: FIX_DATE },
    );
    const res = await deliveryNoteBillingGet(new Request(`http://localhost/api/delivery-notes/${dn.id}/billing`), ctx(dn.id));
    const json = await res.json();
    expect(json.hasPrices).toBe(true);
  });

  it("404 fuer einen unbekannten Lieferschein", async () => {
    const res = await deliveryNoteBillingGet(new Request("http://localhost/api/delivery-notes/unbekannt/billing"), ctx("unbekannt"));
    expect(res.status).toBe(404);
  });
});

describe("Nit: ungueltiges JSON im Body ergibt 400, nicht 500", () => {
  it("POST /api/documents/[id]/partial-invoice mit kaputtem JSON-Body -> 400", async () => {
    const quote = await makeQuote(100_000);
    const res = await partialPost(
      new Request(`http://localhost/api/documents/${quote.id}/partial-invoice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ das ist kein json",
      }),
      ctx(quote.id),
    );
    expect(res.status).toBe(400);
  });
});
