import { describe, it, expect } from "vitest";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { buildFacturXCII } from "@/lib/einvoice/cii";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { testPdfTheme } from "../helpers/pdf-theme";
import type { EInvoiceData } from "@/lib/einvoice/types";

const data: EInvoiceData = {
  number: "RE-2026-0001",
  type: "INVOICE",
  issueDate: new Date("2026-06-09"),
  dueDate: new Date("2026-06-23"),
  deliveryDate: new Date("2026-06-01"),
  currency: "EUR",
  buyerReference: "04011000-12345-86",
  paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
  notes: "Vielen Dank für Ihren Auftrag.",
  seller: {
    name: "Test GmbH",
    addressLine1: "Hauptstr. 1",
    postalCode: "21339",
    city: "Lüneburg",
    countryCode: "DE",
    vatId: "DE123456789",
    email: "info@test.de",
    phone: "+49 4131 100",
    contactName: "Max Mustermann",
  },
  buyer: {
    name: "Kunde AG",
    addressLine1: "Marktplatz 2",
    postalCode: "20095",
    city: "Hamburg",
    countryCode: "DE",
    vatId: "DE987654321",
    email: "einkauf@kunde.de",
  },
  lines: [
    { id: "1", description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, lineNetCents: 20000, taxRate: 19, taxCategory: "S" },
    { id: "2", description: "Hosting", quantityMilli: 1000, unit: "MON", unitNetPriceCents: 5000, lineNetCents: 5000, taxRate: 19, taxCategory: "S" },
  ],
  taxSubtotals: [{ taxCategory: "S", taxRate: 19, netCents: 25000, taxCents: 4750 }],
  netTotalCents: 25000,
  taxTotalCents: 4750,
  grossTotalCents: 29750,
  payableCents: 29750,
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  bankName: "Test Bank",
};

describe("XRechnung / EN 16931", () => {
  it("erzeugt wohlgeformtes UBL mit Pflicht-Headern", () => {
    const xml = buildXRechnungUBL(data);
    // CustomizationID muss den XRechnung-3.0-Namespace (xeinkauf.de) tragen — sonst BR-DE-21.
    expect(xml).toContain("urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0");
    expect(xml).toContain("<cbc:ID>RE-2026-0001</cbc:ID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).toContain("DE123456789");
    expect(xml).toContain("<cbc:PayableAmount currencyID=\"EUR\">297.50</cbc:PayableAmount>");
  });

  it("besteht die EN-16931-Kernregeln", () => {
    const xml = buildXRechnungUBL(data);
    const result = validateXRechnung(data, xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("erkennt eine Rechensummen-Verletzung (BR-CO-15)", () => {
    const bad = { ...data, grossTotalCents: 99999 };
    const xml = buildXRechnungUBL(bad);
    const result = validateXRechnung(bad, xml);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/BR-CO-15/);
  });

  it("emittiert Steuernummer (BT-32 / FC) für Verkäufer ohne USt-IdNr. (Kleinunternehmer)", () => {
    const ku: EInvoiceData = { ...data, seller: { ...data.seller, vatId: null, taxNumber: "33/123/45678" } };
    const xml = buildXRechnungUBL(ku);
    expect(xml).toContain("<cbc:ID>FC</cbc:ID>");
    expect(xml).toContain("33/123/45678");
    expect(validateXRechnung(ku, xml).errors).toEqual([]);
  });

  it("erkennt einen Beleg nur mit HEADING-Zeile als Verletzung von BR-16 (keine ITEM-Position)", () => {
    // Commit 0 (Task-4-Review): BR-16 muss die ITEM-Zeilen zaehlen, nicht data.lines.length —
    // eine reine Gliederungszeile (HEADING, §8) darf nicht als "Rechnungsposition" durchgehen.
    const headingOnly: EInvoiceData = {
      ...data,
      lines: [{ id: "1", description: "Ueberschrift", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, lineNetCents: 0, taxRate: 0, taxCategory: "S", lineType: "HEADING" }],
    };
    const xml = buildXRechnungUBL(headingOnly);
    const result = validateXRechnung(headingOnly, xml);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/BR-16/);
  });

  it("erkennt Verkäufer ohne jegliche Steuer-ID (BR-CO-26)", () => {
    const bad: EInvoiceData = { ...data, seller: { ...data.seller, vatId: null, taxNumber: null } };
    const result = validateXRechnung(bad, buildXRechnungUBL(bad));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/BR-CO-26/);
  });

  it("platziert cac:Delivery nach den Parteien und vor TaxTotal (UBL-Reihenfolge)", () => {
    const xml = buildXRechnungUBL(data);
    const customerIdx = xml.indexOf("<cac:AccountingCustomerParty>");
    const deliveryIdx = xml.indexOf("<cac:Delivery>");
    const taxTotalIdx = xml.indexOf("<cac:TaxTotal>");
    expect(deliveryIdx).toBeGreaterThan(customerIdx);
    expect(deliveryIdx).toBeLessThan(taxTotalIdx);
  });

  it("erzeugt für Storno ein UBL CreditNote-Dokument (381, positive Beträge, BillingReference)", () => {
    const credit: EInvoiceData = {
      ...data,
      number: "GS-2026-0001",
      type: "CREDIT_NOTE",
      precedingInvoiceNumber: "RE-2026-0001",
      precedingInvoiceDate: new Date("2026-06-09"),
      lines: data.lines.map((l) => ({ ...l, unitNetPriceCents: -l.unitNetPriceCents, lineNetCents: -l.lineNetCents })),
      taxSubtotals: data.taxSubtotals.map((t) => ({ ...t, netCents: -t.netCents, taxCents: -t.taxCents })),
      netTotalCents: -data.netTotalCents,
      taxTotalCents: -data.taxTotalCents,
      grossTotalCents: -data.grossTotalCents,
      payableCents: -data.payableCents,
    };
    const xml = buildXRechnungUBL(credit);
    expect(xml).toContain("<CreditNote");
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toContain("<cac:CreditNoteLine>");
    expect(xml).toContain("<cbc:CreditedQuantity");
    expect(xml).toContain("RE-2026-0001"); // BillingReference auf Original
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">297.50</cbc:PayableAmount>'); // positiv
    expect(validateXRechnung(credit, xml).errors).toEqual([]);
  });
});

describe("ZUGFeRD / Factur-X (CII)", () => {
  it("erzeugt EN-16931-CII mit korrektem Profil + TypeCode", () => {
    const xml = buildFacturXCII(data);
    expect(xml).toContain("<rsm:CrossIndustryInvoice");
    expect(xml).toContain("urn:cen.eu:en16931:2017");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain("DE123456789"); // Verkäufer-USt-IdNr.
  });

  it("bettet die factur-x.xml in ein gültiges PDF ein", async () => {
    const pdf = await renderZugferdPdf(data, testPdfTheme());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("factur-x.xml");
  });
});
