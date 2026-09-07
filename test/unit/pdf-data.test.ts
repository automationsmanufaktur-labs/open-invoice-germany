import { describe, it, expect } from "vitest";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";

/**
 * K1 — Belegrabatt muss im Dokument-PDF (Angebot/AB/Proforma) ankommen, genau wie im
 * Rechnungs-Mapper. Vorher fehlte der Beleg-Rabatt/-Aufschlag komplett im Dokument-Pfad.
 */
describe("buildDocEInvoiceData — Belegrabatt (K1)", () => {
  const baseOrg = {
    legalName: "Verkaeufer GmbH",
    addressLine1: "Hauptstr. 1",
    addressLine2: null,
    postalCode: "12345",
    city: "Berlin",
    country: "DE",
    vatId: "DE123456789",
    taxNumber: null,
    email: null,
    phone: null,
    electronicAddress: null,
    iban: null,
    bic: null,
    bankName: null,
  };
  const baseCustomer = {
    name: "Kunde AG",
    contactName: null,
    addressLine1: "Kundenweg 2",
    addressLine2: null,
    postalCode: "54321",
    city: "Hamburg",
    countryCode: "DE",
    vatId: null,
    email: null,
    leitwegId: null,
  };

  it("rechnet 3x100 EUR (19%) mit 10% Belegrabatt auf netto 27000 / brutto 32130", () => {
    const data = buildDocEInvoiceData({
      number: "A-2026-0001",
      kind: "ANGEBOT",
      issueDate: new Date("2026-09-03T00:00:00.000Z"),
      validUntil: null,
      currency: "EUR",
      notes: null,
      org: baseOrg,
      customer: baseCustomer,
      documentDiscountPermille: 100,
      lines: [
        {
          description: "Beratung",
          quantityMilli: 3000,
          unit: "Stk",
          unitNetPriceCents: 10000,
          lineNetCents: 30000,
          taxRate: 19,
          taxCategory: "S",
        },
      ],
    });

    expect(data.netTotalCents).toBe(27000);
    expect(data.grossTotalCents).toBe(32130);
    expect(data.documentAllowances).toHaveLength(1);
    expect(data.documentAllowances?.[0]?.amountCents).toBe(3000);
    expect(data.lineTotalCents).toBe(30000);
    expect(data.allowanceTotalCents).toBe(3000);
  });
});
