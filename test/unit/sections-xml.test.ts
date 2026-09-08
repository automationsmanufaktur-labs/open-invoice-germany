/**
 * Phase 4b (Task 4) — Positionsblöcke (HEADING/TEXT/SUBTOTAL) und Rich-Text bleiben
 * PDF-only: im XML tauchen nur ITEM-Zeilen auf, mit BT-154 (Langtext, Klartext),
 * BT-155 (Artikelnummer) und BT-13 (Bestellnummer, Kopfebene). §8: kein Menge-0-
 * Workaround, Nicht-ITEM-Zeilen tragen nie Beträge/gehen nie in Summen oder XML.
 */
import { describe, it, expect } from "vitest";
import { buildEInvoiceData, type MapInput } from "@/lib/einvoice/mapper";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { buildFacturXCII } from "@/lib/einvoice/cii";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { computeSubtotals } from "@/domain/document/lines";
import { testPdfTheme } from "../helpers/pdf-theme";

const ORG: MapInput["org"] = {
  legalName: "Test GmbH", addressLine1: "Hauptstr. 1", addressLine2: null, postalCode: "21339", city: "Lüneburg",
  country: "DE", vatId: "DE123456789", taxNumber: null, email: "info@test.de", phone: null,
  electronicAddress: null, iban: "DE02120300000000202051", bic: "BYLADEM1001", bankName: "Test Bank",
};
const CUSTOMER: MapInput["customer"] = {
  name: "Kunde AG", contactName: null, addressLine1: "Marktplatz 2", addressLine2: null, postalCode: "20095",
  city: "Hamburg", countryCode: "DE", vatId: "DE987654321", email: "einkauf@kunde.de", leitwegId: null,
};

// Lastenheft-Beispiel: Einrichtung (ITEM, 500,00 €), Hosting (HEADING), Hosting 12
// Monate (ITEM, 240,00 €), Domainverwaltung (ITEM, 60,00 €), Zwischensumme Hosting
// (SUBTOTAL) -> 300,00 € (Einrichtung fließt NICHT ein, siehe lines.ts).
function buildSectionsInput(): MapInput {
  const lines: MapInput["lines"] = [
    {
      id: "1",
      lineType: "ITEM",
      description: "Einrichtung",
      descriptionLong: "**Wichtig:** einmalige Einrichtungsgebühr.",
      articleNumber: "ART-001",
      quantityMilli: 1000,
      unit: "C62",
      unitNetPriceCents: 50000,
      lineNetCents: 50000,
      taxRate: 19,
      taxCategory: "S",
    },
    {
      id: "2",
      lineType: "HEADING",
      description: "Hosting",
      quantityMilli: 0,
      unit: "C62",
      unitNetPriceCents: 0,
      lineNetCents: 0,
      taxRate: 0,
      taxCategory: "S",
    },
    {
      id: "3",
      lineType: "TEXT",
      description: "Freitext",
      descriptionLong: "Gilt für die folgenden Positionen.",
      quantityMilli: 0,
      unit: "C62",
      unitNetPriceCents: 0,
      lineNetCents: 0,
      taxRate: 0,
      taxCategory: "S",
    },
    {
      id: "4",
      lineType: "ITEM",
      description: "Hosting 12 Monate",
      quantityMilli: 1000,
      unit: "C62",
      unitNetPriceCents: 24000,
      lineNetCents: 24000,
      taxRate: 19,
      taxCategory: "S",
    },
    {
      id: "5",
      lineType: "ITEM",
      description: "Domainverwaltung",
      quantityMilli: 1000,
      unit: "C62",
      unitNetPriceCents: 6000,
      lineNetCents: 6000,
      taxRate: 19,
      taxCategory: "S",
    },
    {
      id: "6",
      lineType: "SUBTOTAL",
      description: "Zwischensumme Hosting",
      quantityMilli: 0,
      unit: "C62",
      unitNetPriceCents: 0,
      lineNetCents: 0,
      taxRate: 0,
      taxCategory: "S",
    },
  ];
  const netTotalCents = 50000 + 24000 + 6000;
  const taxTotalCents = Math.round(netTotalCents * 0.19);
  return {
    number: "RE-2035-0001",
    type: "INVOICE",
    issueDate: new Date("2035-06-09"),
    dueDate: new Date("2035-07-09"),
    deliveryDate: null,
    currency: "EUR",
    buyerReference: null,
    orderNumber: "BEST-4711",
    paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    notes: null,
    netTotalCents,
    taxTotalCents,
    grossTotalCents: netTotalCents + taxTotalCents,
    paidAmountCents: 0,
    taxBreakdownJson: JSON.stringify([{ taxCategory: "S", taxRate: 19, netCents: netTotalCents, taxCents: taxTotalCents, baseNetCents: netTotalCents, allowanceCents: 0, chargeCents: 0 }]),
    org: ORG,
    customer: CUSTOMER,
    lines,
  };
}

describe("buildEInvoiceData — Positionsblöcke (Phase 4b, §8)", () => {
  it("übernimmt lineType/descriptionLong/articleNumber für ALLE Zeilen (PDF braucht sie), Mapper filtert nicht", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    expect(data.lines).toHaveLength(6);
    expect(data.lines.map((l) => l.lineType)).toEqual(["ITEM", "HEADING", "TEXT", "ITEM", "ITEM", "SUBTOTAL"]);
    expect(data.orderNumber).toBe("BEST-4711");
  });

  it("Nicht-ITEM-Zeilen tragen keine Beträge (§8, kein Menge-0-Workaround)", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    for (const line of data.lines) {
      if (line.lineType !== "ITEM") {
        expect(line.lineNetCents).toBe(0);
        expect(line.unitNetPriceCents).toBe(0);
      }
    }
  });
});

describe("buildXRechnungUBL — nur ITEM-Zeilen, BT-154/155/13 (Phase 4b)", () => {
  it("filtert HEADING/TEXT/SUBTOTAL aus dem XML, nummeriert IDs fortlaufend über die ITEMs neu", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildXRechnungUBL(data);
    const itemLineMatches = xml.match(/<cac:InvoiceLine>/g) ?? [];
    expect(itemLineMatches).toHaveLength(3);
    expect(xml).not.toContain("Hosting</cbc:Name>"); // HEADING-Titel selbst nicht als Item-Name
    expect(xml).not.toContain("Freitext");
    expect(xml).not.toContain("Zwischensumme Hosting");
    // IDs 1..3 fortlaufend über die ITEMs, nicht die gespeicherte Position (1,4,5).
    expect(xml).toMatch(/<cac:InvoiceLine>\s*<cbc:ID>1<\/cbc:ID>/);
    expect(xml).toMatch(/<cbc:ID>2<\/cbc:ID>\s*<cbc:InvoicedQuantity/);
    expect(xml).toMatch(/<cbc:ID>3<\/cbc:ID>\s*<cbc:InvoicedQuantity/);
  });

  it("BT-154 (Description) steht vor BT-153 (Name), als Klartext ohne Markdown-Marker", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildXRechnungUBL(data);
    expect(xml).toContain("<cbc:Description>Wichtig: einmalige Einrichtungsgebühr.</cbc:Description>");
    expect(xml).not.toContain("**Wichtig**");
    expect(xml).not.toContain("**Wichtig:**");
    const descIndex = xml.indexOf("<cbc:Description>Wichtig");
    const nameIndex = xml.indexOf("<cbc:Name>Einrichtung</cbc:Name>");
    expect(descIndex).toBeGreaterThan(-1);
    expect(descIndex).toBeLessThan(nameIndex);
  });

  it("BT-155 (SellersItemIdentification) steht nach BT-153 (Name)", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildXRechnungUBL(data);
    const nameIndex = xml.indexOf("<cbc:Name>Einrichtung</cbc:Name>");
    const idIndex = xml.indexOf("<cac:SellersItemIdentification>");
    expect(idIndex).toBeGreaterThan(nameIndex);
    expect(xml).toContain("<cac:SellersItemIdentification>\n        <cbc:ID>ART-001</cbc:ID>");
  });

  it("BT-13 (OrderReference) steht direkt nach BuyerReference und vor BillingReference", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildXRechnungUBL(data);
    expect(xml).toContain("<cac:OrderReference>\n    <cbc:ID>BEST-4711</cbc:ID>");
    const buyerRefIndex = xml.indexOf("<cbc:BuyerReference>");
    const orderRefIndex = xml.indexOf("<cac:OrderReference>");
    expect(orderRefIndex).toBeGreaterThan(buyerRefIndex);
  });

  it("besteht die lokale EN-16931-Kernvalidierung", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildXRechnungUBL(data);
    const report = validateXRechnung(data, xml);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("ohne lineType (Alt-Fixture) wird ITEM angenommen — Bestandsverhalten bleibt", () => {
    const input = buildSectionsInput();
    input.lines = input.lines
      .filter((l) => l.lineType === "ITEM")
      .map((l) => {
        const rest: Record<string, unknown> = { ...l };
        delete rest.lineType;
        delete rest.descriptionLong;
        delete rest.articleNumber;
        return rest as (typeof input.lines)[number];
      });
    const data = buildEInvoiceData(input);
    const xml = buildXRechnungUBL(data);
    expect((xml.match(/<cac:InvoiceLine>/g) ?? [])).toHaveLength(3);
    expect(data.lines.every((l) => l.lineType === "ITEM")).toBe(true);
  });
});

describe("buildFacturXCII — nur ITEM-Zeilen, BT-154/155/13 (Phase 4b)", () => {
  it("filtert HEADING/TEXT/SUBTOTAL aus dem XML, nummeriert LineIDs fortlaufend über die ITEMs neu", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildFacturXCII(data);
    const lineMatches = xml.match(/<ram:IncludedSupplyChainTradeLineItem>/g) ?? [];
    expect(lineMatches).toHaveLength(3);
    expect(xml).not.toContain("Zwischensumme Hosting");
    expect(xml).toContain("<ram:LineID>1</ram:LineID>");
    expect(xml).toContain("<ram:LineID>2</ram:LineID>");
    expect(xml).toContain("<ram:LineID>3</ram:LineID>");
  });

  it("BT-155 (SellerAssignedID) steht vor BT-153 (Name), BT-154 (Description) danach, als Klartext", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildFacturXCII(data);
    expect(xml).toContain("<ram:SellerAssignedID>ART-001</ram:SellerAssignedID>");
    expect(xml).toContain("<ram:Description>Wichtig: einmalige Einrichtungsgebühr.</ram:Description>");
    expect(xml).not.toContain("**Wichtig**");
    const idIndex = xml.indexOf("<ram:SellerAssignedID>");
    const nameIndex = xml.indexOf("<ram:Name>Einrichtung</ram:Name>");
    const descIndex = xml.indexOf("<ram:Description>Wichtig");
    expect(idIndex).toBeLessThan(nameIndex);
    expect(descIndex).toBeGreaterThan(nameIndex);
  });

  it("BT-13 (BuyerOrderReferencedDocument) steht in ApplicableHeaderTradeAgreement nach BuyerTradeParty", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const xml = buildFacturXCII(data);
    expect(xml).toContain("<ram:IssuerAssignedID>BEST-4711</ram:IssuerAssignedID>");
    const buyerIndex = xml.lastIndexOf("</ram:BuyerTradeParty>");
    const orderIndex = xml.indexOf("<ram:BuyerOrderReferencedDocument>");
    const agreementCloseIndex = xml.indexOf("</ram:ApplicableHeaderTradeAgreement>");
    expect(orderIndex).toBeGreaterThan(buyerIndex);
    expect(orderIndex).toBeLessThan(agreementCloseIndex);
  });
});

describe("computeSubtotals — PDF-Datenbasis für Task 4", () => {
  it("berechnet die Zwischensumme seit der letzten HEADING-Zeile (Lastenheft-Beispiel)", () => {
    const data = buildEInvoiceData(buildSectionsInput());
    const subtotals = computeSubtotals(data.lines.map((l) => ({ lineType: l.lineType ?? "ITEM", lineNetCents: l.lineNetCents })));
    // Index 5 = SUBTOTAL-Zeile -> 240,00 + 60,00 = 300,00 €, OHNE die Einrichtung (500,00 €).
    expect(subtotals[5]).toBe(30000);
    expect(subtotals.filter((s) => s !== 0)).toEqual([30000]);
  });
});

describe("renderInvoicePdf — Positionsblöcke + Rich-Text (Phase 4b)", () => {
  it("rendert HEADING/TEXT/SUBTOTAL/ITEM inkl. Rich-Text-Langtext und Artikelnummer-Spalte ohne Fehler", async () => {
    const { renderInvoicePdf } = await import("@/lib/pdf/invoice-pdf");
    const data = buildEInvoiceData(buildSectionsInput());
    const pdf = await renderInvoicePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("ohne Artikelnummern bleibt die Beschreibungsspalte in voller Breite (keine Artikelnummer-Spalte)", async () => {
    const { renderInvoicePdf } = await import("@/lib/pdf/invoice-pdf");
    const input = buildSectionsInput();
    input.lines = input.lines.map((l) => ({ ...l, articleNumber: undefined }));
    const data = buildEInvoiceData(input);
    const pdf = await renderInvoicePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("buildDocEInvoiceData — Positionsblöcke im Angebots-PDF (Phase 4b)", () => {
  it("übernimmt lineType/descriptionLong/articleNumber für Quote-Zeilen (PDF-only, kein XML)", async () => {
    const { buildDocEInvoiceData } = await import("@/domain/document/pdf-data");
    const data = buildDocEInvoiceData({
      number: "A-2035-0001",
      kind: "ANGEBOT",
      issueDate: new Date("2035-06-09"),
      validUntil: null,
      currency: "EUR",
      notes: null,
      org: {
        legalName: "Verkaeufer GmbH", addressLine1: "Hauptstr. 1", addressLine2: null, postalCode: "12345",
        city: "Berlin", country: "DE", vatId: "DE123456789", taxNumber: null, email: null, phone: null,
        electronicAddress: null, iban: null, bic: null, bankName: null,
      },
      customer: {
        name: "Kunde AG", contactName: null, addressLine1: "Kundenweg 2", addressLine2: null, postalCode: "54321",
        city: "Hamburg", countryCode: "DE", vatId: null, email: null, leitwegId: null,
      },
      lines: [
        { description: "Hosting", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, lineNetCents: 0, taxRate: 0, taxCategory: "S", lineType: "HEADING" },
        {
          description: "Beratung",
          descriptionLong: "_Vor Ort_ Beratung.",
          articleNumber: "ART-001",
          quantityMilli: 3000,
          unit: "Stk",
          unitNetPriceCents: 10000,
          lineNetCents: 30000,
          taxRate: 19,
          taxCategory: "S",
          lineType: "ITEM",
        },
      ],
    });
    expect(data.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM"]);
    expect(data.lines[1]?.descriptionLong).toBe("_Vor Ort_ Beratung.");
    expect(data.lines[1]?.articleNumber).toBe("ART-001");
  });
});
