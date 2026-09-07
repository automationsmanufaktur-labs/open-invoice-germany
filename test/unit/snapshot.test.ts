import { describe, it, expect } from "vitest";
import { sellerSnapshotSchema, buyerSnapshotSchema } from "@/schemas";
import { buildSellerSnapshot, buildBuyerSnapshot, parseSellerSnapshot, parseBuyerSnapshot } from "@/domain/snapshot";
import type { MapInput } from "@/lib/einvoice/mapper";

const org = {
  legalName: "Muster GmbH", addressLine1: "Weg 1", addressLine2: null, postalCode: "12345", city: "Ort",
  country: "DE", vatId: "DE123456789", taxNumber: null, email: "a@b.de", phone: null,
  electronicAddress: null, iban: "DE00", bic: null, bankName: null,
};
const customer = {
  name: "Kunde AG", contactName: "Frau X", addressLine1: "Str. 2", addressLine2: null, postalCode: "54321",
  city: "Stadt", countryCode: "DE", vatId: null, email: "k@x.de", leitwegId: null,
};

describe("Snapshot-Builder und -Schemas", () => {
  it("Builder-Ausgabe besteht das Zod-Schema", () => {
    expect(sellerSnapshotSchema.safeParse(buildSellerSnapshot(org)).success).toBe(true);
    expect(buyerSnapshotSchema.safeParse(buildBuyerSnapshot(customer)).success).toBe(true);
  });

  it("Schluesselmengen entsprechen exakt den Mapper-Eingaben", () => {
    expect(Object.keys(buildSellerSnapshot(org)).sort()).toEqual(Object.keys(org).sort());
    expect(Object.keys(buildBuyerSnapshot(customer)).sort()).toEqual(Object.keys(customer).sort());
    // Compile-Time-Waechter: Builder-Ausgabe muss der Mapper-Eingabe entsprechen.
    const _sellerCheck: MapInput["org"] = buildSellerSnapshot(org);
    const _buyerCheck: MapInput["customer"] = buildBuyerSnapshot(customer);
    void _sellerCheck; void _buyerCheck;
  });

  it("parse bevorzugt einen gueltigen Snapshot", () => {
    const json = JSON.stringify({ ...buildSellerSnapshot(org), legalName: "Alt GmbH" });
    expect(parseSellerSnapshot(json, org, "inv-1").legalName).toBe("Alt GmbH");
  });

  it("parse faellt bei ungueltigem Snapshot auf die Relation zurueck", () => {
    expect(parseSellerSnapshot("{nicht json", org, "inv-1")).toEqual(org);
    expect(parseBuyerSnapshot(JSON.stringify({ name: 1 }), customer, "inv-1")).toEqual(customer);
    expect(parseBuyerSnapshot(null, customer, "inv-1")).toEqual(customer);
  });

  it("internalNotes erreicht EInvoiceData strukturell nicht", async () => {
    const { buildEInvoiceData } = await import("@/lib/einvoice/mapper");
    const data = buildEInvoiceData({
      number: "RE-1", type: "INVOICE", issueDate: new Date(), dueDate: null, deliveryDate: null, currency: "EUR",
      buyerReference: null, paymentTerms: null, notes: "sichtbar", netTotalCents: 0, taxTotalCents: 0,
      grossTotalCents: 0, paidAmountCents: 0, taxBreakdownJson: "[]", org, customer, lines: [],
      // @ts-expect-error internalNotes ist bewusst kein Teil von MapInput
      internalNotes: "GEHEIM",
    });
    expect(JSON.stringify(data)).not.toContain("GEHEIM");
  });

  it("Kopf-/Fusstext wird gerendert, geht aber nicht ins XRechnung-/ZUGFeRD-XML (Ruling)", async () => {
    const { buildEInvoiceData } = await import("@/lib/einvoice/mapper");
    const { buildXRechnungUBL } = await import("@/lib/einvoice/xrechnung");
    const { buildFacturXCII } = await import("@/lib/einvoice/cii");
    const data = buildEInvoiceData({
      number: "RE-1", type: "INVOICE", issueDate: new Date(), dueDate: null, deliveryDate: null, currency: "EUR",
      buyerReference: null, paymentTerms: null, notes: "sichtbar",
      headerText: "KOPFTEXT-MARKER {{document.number}}", footerText: "FUSSTEXT-MARKER",
      netTotalCents: 0, taxTotalCents: 0, grossTotalCents: 0, paidAmountCents: 0, taxBreakdownJson: "[]",
      org, customer, lines: [],
    });
    expect(data.headerText).toBe("KOPFTEXT-MARKER RE-1");
    expect(data.footerText).toBe("FUSSTEXT-MARKER");

    const ubl = buildXRechnungUBL(data);
    expect(ubl).not.toContain("KOPFTEXT-MARKER");
    expect(ubl).not.toContain("FUSSTEXT-MARKER");

    const cii = buildFacturXCII(data);
    expect(cii).not.toContain("KOPFTEXT-MARKER");
    expect(cii).not.toContain("FUSSTEXT-MARKER");
  });
});
