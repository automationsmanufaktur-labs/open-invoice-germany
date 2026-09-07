/**
 * Fix-Runde 1 (Koordinator): `compress` ist BLOCKING niemals fest auf `false` im
 * Produktionspfad — Default in allen drei Renderern ist `true` (FlateDecode-
 * komprimierte Content-Streams), NUR `testPdfTheme()` / explizite Test-Call-Sites
 * setzen `compress: false` (damit `pdf-parse`s sehr alte, mitgelieferte pdf.js-Version
 * PDFs mit `pdf-parse` lesen kann — siehe test/helpers/pdf-theme.ts).
 */
import { describe, it, expect } from "vitest";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { DEFAULT_BRANDING_SETTINGS } from "@/domain/settings/branding";
import { DEFAULT_PRINT_SETTINGS } from "@/domain/settings/print";
import { testPdfTheme } from "../helpers/pdf-theme";
import type { PdfTheme } from "@/lib/pdf/theme";
import type { EInvoiceData } from "@/lib/einvoice/types";

/** Ein "echtes" Produktions-Theme wie `loadPdfTheme` es liefert — `compress` NICHT
 *  gesetzt (der Renderer-Default `true` muss greifen). */
function productionTheme(): PdfTheme {
  return {
    brand: structuredClone(DEFAULT_BRANDING_SETTINGS),
    options: structuredClone(DEFAULT_PRINT_SETTINGS),
    showPaymentTermsText: true,
  };
}

function minimalData(): EInvoiceData {
  return {
    number: "RE-2056-00001",
    type: "INVOICE",
    issueDate: new Date("2056-03-10"),
    currency: "EUR",
    seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin", countryCode: "DE" },
    buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt", countryCode: "DE" },
    lines: [
      {
        id: "1",
        description: "Testposition",
        quantityMilli: 1000,
        unit: "C62",
        unitNetPriceCents: 1000,
        lineNetCents: 1000,
        taxRate: 19,
        taxCategory: "S",
        lineType: "ITEM",
      },
    ],
    taxSubtotals: [{ taxCategory: "S", taxRate: 19, netCents: 1000, taxCents: 190 }],
    netTotalCents: 1000,
    taxTotalCents: 190,
    grossTotalCents: 1190,
    payableCents: 1190,
    iban: null,
  };
}

describe("PdfTheme.compress — Default an im Produktionspfad", () => {
  it("ohne theme.compress (Produktions-Theme): PDF ist FlateDecode-komprimiert", async () => {
    const pdf = await renderInvoicePdf(minimalData(), productionTheme());
    expect(pdf.toString("latin1")).toMatch(/\/FlateDecode/);
  });

  it("testPdfTheme() (compress:false): PDF ist NICHT komprimiert", async () => {
    const pdf = await renderInvoicePdf(minimalData(), testPdfTheme());
    expect(pdf.toString("latin1")).not.toMatch(/\/FlateDecode/);
  });
});
