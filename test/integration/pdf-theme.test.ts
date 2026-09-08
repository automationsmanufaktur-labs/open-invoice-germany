/**
 * Phase 7, Task 3 (§35-§37) — PdfTheme-Pipeline (loadPdfTheme + Renderer). Testjahr 2056
 * (siehe plan-header.md).
 */
import { describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { loadPdfTheme } from "@/domain/settings/theme";
import { savePrintSettings } from "@/domain/settings/print";
import { saveBrandingSettings, loadBrandingSettings } from "@/domain/settings/branding";
import { saveDocumentSettings } from "@/domain/document/settings";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { renderDeliveryNotePdf, type DeliveryNotePdfData } from "@/lib/pdf/delivery-note-pdf";
import { renderDunningPdf, type DunningPdfData } from "@/lib/pdf/dunning-pdf";
import type { EInvoiceData, EInvoiceLine } from "@/lib/einvoice/types";
import { parsePdf, testPdfTheme, testPngBuffer } from "../helpers/pdf-theme";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import type { CreateInvoiceInput } from "@/schemas";
import { DEFAULT_PRINT_SETTINGS } from "@/domain/settings/print";
import { DEFAULT_BRANDING_SETTINGS } from "@/domain/settings/branding";

async function makeOrg(overrides: Partial<{ iban: string | null }> = {}) {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Pdf-Theme Test GmbH",
      addressLine1: "Teststr. 1",
      postalCode: "12345",
      city: "Berlin",
      iban: overrides.iban ?? "DE02120300000000202051",
      bic: "INGDDEFFXXX",
      bankName: "Testbank",
    },
  });
  return org.id;
}

function manyLines(count: number): EInvoiceLine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    description: `Testposition ${i + 1}`,
    quantityMilli: 1000,
    unit: "C62",
    unitNetPriceCents: 1000,
    lineNetCents: 1000,
    taxRate: 19,
    taxCategory: "S",
    lineType: "ITEM" as const,
  }));
}

function baseInvoiceData(overrides: Partial<EInvoiceData> = {}): EInvoiceData {
  const lines = overrides.lines ?? manyLines(1);
  const netTotal = lines.reduce((sum, l) => sum + l.lineNetCents, 0);
  const taxTotal = Math.round(netTotal * 0.19);
  const grossTotal = netTotal + taxTotal;
  return {
    number: "RE-2056-00001",
    type: "INVOICE",
    issueDate: new Date("2056-03-10"),
    dueDate: new Date("2056-03-24"),
    currency: "EUR",
    seller: {
      name: "Muster GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "12345",
      city: "Berlin",
      countryCode: "DE",
    },
    buyer: {
      name: "Kunde AG",
      addressLine1: "Kundenweg 2",
      postalCode: "54321",
      city: "Stadt",
      countryCode: "DE",
    },
    lines,
    taxSubtotals: [{ taxCategory: "S", taxRate: 19, netCents: netTotal, taxCents: taxTotal }],
    netTotalCents: netTotal,
    taxTotalCents: taxTotal,
    grossTotalCents: grossTotal,
    payableCents: grossTotal,
    iban: "DE02120300000000202051",
    bic: null,
    bankName: "Testbank",
    giroAmountCents: grossTotal,
    ...overrides,
  };
}

describe("PdfTheme — Seitenzahlen (pdf-parse)", () => {
  it("eine lange Rechnung mit vielen Positionen erhält 'Seite 1 von 2' unten rechts, genau 2 Seiten (B1)", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ lines: manyLines(60), number: "RE-2056-00010", giroAmountCents: 0 });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.numpages).toBe(2);
    expect(parsed.text).toContain("Seite 1 von 2");
  });

  it("eine 1-Zeilen-Rechnung bleibt bei genau 1 Seite (B1 — keine Blattseite durch Seitenzahlen)", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const data = baseInvoiceData({ giroAmountCents: 0 });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.numpages).toBe(1);
    expect(parsed.text).toContain("Seite 1 von 1");
  });

  it("eine kurze Rechnung bleibt einseitig, keine 'Seite x von y'-Zeile, wenn showPageNumbers aus ist", async () => {
    const orgId = await makeOrg();
    await savePrintSettings(orgId, { showPageNumbers: false });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ giroAmountCents: 0 });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.numpages).toBe(1);
    expect(parsed.text).not.toContain("Seite 1 von");
  });
});

describe("PdfTheme — GiroCode (§37)", () => {
  it("mit IBAN + showGiroCode an: das PDF enthält ein Image-XObject (QR-Code-PNG)", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ number: "RE-2056-00002" });
    const pdf = await renderInvoicePdf(data, theme);
    expect(pdf.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
  });

  it("ohne IBAN: kein GiroCode, kein Image-XObject", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ number: "RE-2056-00003", iban: null, bic: null });
    const pdf = await renderInvoicePdf(data, theme);
    expect(pdf.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("Gutschrift (CREDIT_NOTE): kein GiroCode", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ number: "GS-2056-00001", type: "CREDIT_NOTE" });
    const pdf = await renderInvoicePdf(data, theme);
    expect(pdf.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("showGiroCode aus: kein GiroCode trotz IBAN", async () => {
    const orgId = await makeOrg();
    await savePrintSettings(orgId, { showGiroCode: false });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ number: "RE-2056-00004" });
    const pdf = await renderInvoicePdf(data, theme);
    expect(pdf.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("Fremdwaehrung (USD): kein GiroCode trotz IBAN (B2 — GiroCode ist EUR-only)", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const data = baseInvoiceData({ number: "RE-2056-00011", currency: "USD" });
    const pdf = await renderInvoicePdf(data, theme);
    expect(pdf.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("offener Betrag 0 (vollständig bezahlt): kein GiroCode", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ number: "RE-2056-00005", giroAmountCents: 0 });
    const pdf = await renderInvoicePdf(data, theme);
    expect(pdf.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });
});

describe("PdfTheme — Lieferschein-Lieferadresse (§36)", () => {
  function baseDeliveryNoteData(overrides: Partial<DeliveryNotePdfData> = {}): DeliveryNotePdfData {
    return {
      number: "LS-2056-00001",
      issueDate: new Date("2056-03-10"),
      currency: "EUR",
      seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin" },
      buyer: { name: "Lieferadressen-Kunde AG", addressLine1: "Lieferweg 9", postalCode: "99999", city: "Lieferstadt" },
      lines: [{ pos: 1, description: "Testartikel", quantityMilli: 1000, unit: "C62" }],
      showPrices: false,
      showTax: false,
      showArticleNumber: false,
      showDescription: true,
      showDeliveryAddress: true,
      ...overrides,
    };
  }

  it("Empfängerblock steht IMMER im PDF-Text, auch bei showDeliveryAddress aus (S7, Fix-Welle)", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const pdf = await renderDeliveryNotePdf(baseDeliveryNoteData({ showDeliveryAddress: false }), theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Lieferadressen-Kunde AG");
    expect(parsed.text).toContain("Lieferweg 9");
  });

  it("showDeliveryAddress an + Standard-SHIPPING-Adresse vorhanden: zusaetzlicher Lieferadress-Block im PDF-Text", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderDeliveryNotePdf(
      baseDeliveryNoteData({
        showDeliveryAddress: true,
        deliveryAddress: { addressLine1: "Lagerhalle 7", postalCode: "88888", city: "Werksstadt" },
      }),
      theme,
    );
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Lieferadresse:");
    expect(parsed.text).toContain("Lagerhalle 7");
    expect(parsed.text).toContain("Werksstadt");
    // Empfängerblock bleibt zusaetzlich erhalten.
    expect(parsed.text).toContain("Lieferadressen-Kunde AG");
  });

  it("showDeliveryAddress an, aber KEINE Standard-SHIPPING-Adresse: kein Lieferadress-Block", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderDeliveryNotePdf(baseDeliveryNoteData({ showDeliveryAddress: true, deliveryAddress: null }), theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).not.toContain("Lieferadresse:");
    expect(parsed.text).toContain("Lieferadressen-Kunde AG"); // Empfängerblock bleibt trotzdem.
  });

  it("showDeliveryAddress aus, aber Standard-SHIPPING-Adresse vorhanden: kein Lieferadress-Block", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderDeliveryNotePdf(
      baseDeliveryNoteData({
        showDeliveryAddress: false,
        deliveryAddress: { addressLine1: "Lagerhalle 7", postalCode: "88888", city: "Werksstadt" },
      }),
      theme,
    );
    const parsed = await parsePdf(pdf);
    expect(parsed.text).not.toContain("Lieferadresse:");
    expect(parsed.text).not.toContain("Lagerhalle 7");
  });
});

describe("PdfTheme — showPaymentTermsText (§33 DocumentSettings)", () => {
  it("an (Default): die Zahlungsziel-/Skonto-Zeile steht im PDF-Text", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    const data = baseInvoiceData({ number: "RE-2056-00007", giroAmountCents: 0, paymentTermsHuman: "Zahlbar bis 24.03.2056 ohne Abzug." });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Zahlbar bis 24.03.2056 ohne Abzug.");
  });

  it("aus: die Zahlungsziel-/Skonto-Zeile fehlt im PDF-Text", async () => {
    const orgId = await makeOrg();
    await saveDocumentSettings(orgId, { showPaymentTermsText: false });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    expect(theme.showPaymentTermsText).toBe(false);
    const data = baseInvoiceData({ number: "RE-2056-00008", giroAmountCents: 0, paymentTermsHuman: "Zahlbar bis 24.03.2056 ohne Abzug." });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).not.toContain("Zahlbar bis 24.03.2056 ohne Abzug.");
  });
});

describe("PdfTheme — S3 (Fix-Welle): Branded-Footer ODER Fallback, nie beide", () => {
  function baseDunningData(overrides: Partial<DunningPdfData> = {}): DunningPdfData {
    return {
      number: "M-2056-00001",
      level: 1,
      sentDate: new Date("2056-05-01"),
      newDueDate: new Date("2056-05-15"),
      currency: "EUR",
      seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin" },
      buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt" },
      invoiceNumber: "RE-2056-00001",
      invoiceDate: new Date("2056-03-10"),
      openAmountCents: 11900,
      interestCents: 100,
      flatFee40Cents: 4000,
      feeCents: 0,
      lateFeeCents: 4100,
      totalCents: 16000,
      daysOverdue: 20,
      ...overrides,
    };
  }

  function baseDeliveryNoteData(overrides: Partial<DeliveryNotePdfData> = {}): DeliveryNotePdfData {
    return {
      number: "LS-2056-00002",
      issueDate: new Date("2056-03-10"),
      currency: "EUR",
      seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin" },
      buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt" },
      lines: [{ pos: 1, description: "Testartikel", quantityMilli: 1000, unit: "C62" }],
      showPrices: false,
      showTax: false,
      showArticleNumber: false,
      showDescription: true,
      showDeliveryAddress: false,
      ...overrides,
    };
  }

  // Fix-Runde 1 (Koordinator, Punkt 3): der Seller-Snapshot bekommt hier vatId/taxNumber,
  // damit die AUTO-Fusszeile auch die Steuer/Inhaber-Spalte fuellt — nur so beweist der
  // Test wirklich, dass die FUSSZEILE gerendert wurde (Firma/Adresse allein stehen auch
  // im Absenderblock am Kopf, "Muster GmbH"/"Hauptstr. 1" haetten also selbst bei einer
  // KOMPLETT FEHLENDEN Fusszeile gruen bestanden).
  function sellerWithTaxFacts() {
    return { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin", countryCode: "DE", vatId: "DE123456789", taxNumber: "12/345/67890" };
  }

  it("Rechnung: ohne Briefpapier-Fusszeile steht der Aussteller-Fallback (AUTO-Fusszeile) im PDF", async () => {
    const orgId = await makeOrg();
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderInvoicePdf(baseInvoiceData({ number: "RE-2056-00009", giroAmountCents: 0, seller: sellerWithTaxFacts() }), theme);
    const parsed = await parsePdf(pdf);
    // Phase 11b, Task 3 — der Aussteller-Fallback ist jetzt die AUTO-Fusszeile
    // (footer.ts#buildFooterColumns): Firma/Adresse stehen als eigene Spalte mit
    // eigenen Zeilen statt als ein Komma-getrennter Fliesstext; die Kernangaben bleiben
    // (nur die Formatierung aendert sich absichtlich, siehe test/unit/pdf-footer.test.ts).
    // Fusszeilen-EXKLUSIVE Angaben (stehen nirgends sonst im Beleg) beweisen, dass die
    // Fusszeile tatsaechlich gezeichnet wurde — nicht nur der Absenderblock am Kopf.
    expect(parsed.text).toContain("Steuer-Nr. 12/345/67890");
    expect(parsed.text).toContain("USt-IdNr. DE123456789");
    // Die gruppierte IBAN kann in der schmalen vierten Fusszeilen-Spalte umbrechen
    // (pdf-parse fuegt dafuer einen Zeilenumbruch ein) — Leerraum vor dem Vergleich
    // entfernen, siehe dieselbe Behandlung in test/unit/pdf-layouts.test.ts.
    expect(parsed.text.replace(/\s+/g, "")).toContain("IBANDE02120300000000202051");
  });

  it("Rechnung: showFooter aus — die Fusszeilen-exklusiven Angaben (IBAN/Steuer-Nr./USt-IdNr.) fehlen im PDF", async () => {
    const orgId = await makeOrg();
    await savePrintSettings(orgId, { showFooter: false });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderInvoicePdf(baseInvoiceData({ number: "RE-2056-00091", giroAmountCents: 0, seller: sellerWithTaxFacts() }), theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).not.toContain("Steuer-Nr. 12/345/67890");
    expect(parsed.text).not.toContain("USt-IdNr. DE123456789");
    expect(parsed.text.replace(/\s+/g, "")).not.toContain("IBANDE02120300000000202051");
  });

  it("Rechnung: MIT Briefpapier-Fusszeile steht NUR die Marken-Fusszeile im PDF, nicht der Fallback", async () => {
    const orgId = await makeOrg();
    await saveBrandingSettings(orgId, { footerMode: "CUSTOM", footerLeft: "Marken-Fusszeile-Links" });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderInvoicePdf(baseInvoiceData({ number: "RE-2056-00010", giroAmountCents: 0 }), theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Marken-Fusszeile-Links");
    expect(parsed.text).not.toContain("Muster GmbH · Hauptstr. 1, 12345 Berlin");
  });

  it("Lieferschein: MIT Briefpapier-Fusszeile steht NUR die Marken-Fusszeile im PDF, nicht der Fallback", async () => {
    const orgId = await makeOrg();
    await saveBrandingSettings(orgId, { footerMode: "CUSTOM", footerCenter: "Marken-Fusszeile-Mitte" });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderDeliveryNotePdf(baseDeliveryNoteData(), theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Marken-Fusszeile-Mitte");
    expect(parsed.text).not.toContain("Muster GmbH · Hauptstr. 1, 12345 Berlin");
  });

  it("Mahnung: MIT Briefpapier-Fusszeile steht NUR die Marken-Fusszeile im PDF, nicht der Fallback", async () => {
    const orgId = await makeOrg();
    await saveBrandingSettings(orgId, { footerMode: "CUSTOM", footerRight: "Marken-Fusszeile-Rechts" });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const pdf = await renderDunningPdf(baseDunningData(), theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Marken-Fusszeile-Rechts");
    expect(parsed.text).not.toContain("Muster GmbH · Hauptstr. 1, 12345 Berlin");
  });
});

describe("PdfTheme — S2 (Fix-Welle): Summenblock aus `right` bei extremen Raendern (5/40 mm)", () => {
  it("marginLeft 5mm, marginRight 40mm: Rechnung enthaelt die Summen im PDF-Text, keine Exception", async () => {
    const orgId = await makeOrg();
    await saveBrandingSettings(orgId, { marginLeftMm: 5, marginRightMm: 40, marginTopMm: 5, marginBottomMm: 5 });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const data = baseInvoiceData({ number: "RE-2056-00011", giroAmountCents: 0 });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Nettobetrag");
    expect(parsed.text).toContain("Gesamtbetrag");
  });

  it("marginLeft 40mm, marginRight 5mm: Rechnung enthaelt die Summen im PDF-Text, keine Exception", async () => {
    const orgId = await makeOrg();
    await saveBrandingSettings(orgId, { marginLeftMm: 40, marginRightMm: 5, marginTopMm: 5, marginBottomMm: 5 });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false;
    const data = baseInvoiceData({ number: "RE-2056-00012", giroAmountCents: 0 });
    const pdf = await renderInvoicePdf(data, theme);
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Nettobetrag");
    expect(parsed.text).toContain("Gesamtbetrag");
  });
});

describe("loadPdfTheme — fehlende Logo-/Hintergrunddatei", () => {
  it("rendert ohne Logo, wenn logoPath auf eine nicht existierende Datei zeigt (kein Wurf)", async () => {
    const orgId = await makeOrg();
    await dbInternal.brandingSettings.create({ data: { orgId, logoPath: "does/not/exist.png" } });
    const theme = await loadPdfTheme(orgId);
    theme.compress = false; // Fix-Runde 1: Produktions-Default ist compress:true; Tests brauchen pdf-parse-kompatible PDFs.
    expect(theme.logoBuffer).toBeUndefined();
    const data = baseInvoiceData({ number: "RE-2056-00006", giroAmountCents: 0 });
    await expect(renderInvoicePdf(data, theme)).resolves.toBeInstanceOf(Buffer);
  });
});

describe("PdfTheme — Phase 11b Layout-Aufloesung (Task 1 geschrieben, Task 3 aktiviert)", () => {
  it("Branding speichert layoutId, layoutByType und footerMode; Organization.ownerName landet im Theme", async () => {
    const orgId = await makeOrg();
    await dbInternal.organization.update({ where: { id: orgId }, data: { ownerName: "Erika Muster" } });
    await saveBrandingSettings(orgId, { layoutId: "schlicht", layoutByType: { DELIVERY_NOTE: "kompakt" }, footerMode: "AUTO" });
    const brand = await loadBrandingSettings(orgId);
    expect(brand.layoutId).toBe("schlicht");
    expect(brand.layoutByType).toEqual({ DELIVERY_NOTE: "kompakt" });
    const theme = await loadPdfTheme(orgId, null, "DELIVERY_NOTE");
    expect(theme.layoutId).toBe("kompakt");
    expect(theme.footerFacts.ownerName).toBe("Erika Muster");
    const inv = await loadPdfTheme(orgId, null, "INVOICE");
    expect(inv.layoutId).toBe("schlicht");
  });

  it("AUTO-Fusszeile: Inhaber und Website stehen im Rechnungs-, Lieferschein- und Mahnungs-PDF", async () => {
    const orgId = await makeOrg();
    await dbInternal.organization.update({ where: { id: orgId }, data: { ownerName: "Erika Muster", website: "muster.example" } });
    const theme = await loadPdfTheme(orgId);
    const inv = await parsePdf(await renderInvoicePdf(baseInvoiceData(), { ...theme, compress: false }));
    expect(inv.text).toContain("Inhaber/-in Erika Muster");
    expect(inv.text).toContain("Web muster.example");

    const dnData: DeliveryNotePdfData = {
      number: "LS-2056-00099",
      issueDate: new Date("2056-03-10"),
      currency: "EUR",
      seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin" },
      buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt" },
      lines: [{ pos: 1, description: "Testartikel", quantityMilli: 1000, unit: "C62" }],
      showPrices: false,
      showTax: false,
      showArticleNumber: false,
      showDescription: true,
      showDeliveryAddress: false,
    };
    const dn = await parsePdf(await renderDeliveryNotePdf(dnData, { ...theme, compress: false }));
    expect(dn.text).toContain("Inhaber/-in Erika Muster");
    expect(dn.text).toContain("Web muster.example");

    const dunningData: DunningPdfData = {
      number: "M-2056-00099",
      level: 1,
      sentDate: new Date("2056-05-01"),
      newDueDate: new Date("2056-05-15"),
      currency: "EUR",
      seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin" },
      buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt" },
      invoiceNumber: "RE-2056-00001",
      invoiceDate: new Date("2056-03-10"),
      openAmountCents: 11900,
      interestCents: 100,
      flatFee40Cents: 4000,
      feeCents: 0,
      lateFeeCents: 4100,
      totalCents: 16000,
      daysOverdue: 20,
    };
    const dun = await parsePdf(await renderDunningPdf(dunningData, { ...theme, compress: false }));
    expect(dun.text).toContain("Inhaber/-in Erika Muster");
    expect(dun.text).toContain("Web muster.example");
  });
});

/** Minimaler Rechnungs-Entwurf (analog test/integration/scheduler.test.ts), nur mit
 *  Kunden-ID — kein explizites Faelligkeitsdatum noetig fuer diesen Test. */
function invoiceInput(customerId: string): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    lines: [{ description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
  } as CreateInvoiceInput;
}

describe("PdfTheme — Phase 11b Task 6: Einfrieren des Layouts beim Festschreiben", () => {
  it("Festschreiben friert das Layout ein; spaetere Organisationsaenderung wirkt nicht mehr", async () => {
    const orgId = await makeOrg();
    await ensureOrgMasterdata(dbInternal, orgId);
    // makeOrg() (Datei-Helfer oben) setzt keine Steuernummer/USt-IdNr. — ohne eine von
    // beiden bricht validateMandatoryFields das Festschreiben ab (§14 Abs.4 Nr.2).
    await dbInternal.organization.update({ where: { id: orgId }, data: { vatId: "DE123456789", taxNumber: "33/123/45678" } });
    // Invoice.number ist GLOBAL eindeutig — eigener Praefix fuer dieses Testjahr (2056).
    await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "PT56-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", new Date("2056-06-01T12:00:00Z"));
    await saveBrandingSettings(orgId, { layoutId: "schlicht" });
    const customer = await dbInternal.customer.create({ data: { orgId, name: "Freeze AG", addressLine1: "A 1", postalCode: "1", city: "B", type: "BUSINESS" } });
    const draft = await createDraftInvoice(orgId, { ...invoiceInput(customer.id) });
    const fin = await finalizeInvoice(draft.id, { now: new Date("2056-06-01T12:00:00Z"), actor: "test" });
    expect(JSON.parse(fin.printOptionsJson!).layoutId).toBe("schlicht");
    await saveBrandingSettings(orgId, { layoutId: "modern" });
    const theme = await loadPdfTheme(orgId, fin.printOptionsJson, "INVOICE");
    expect(theme.layoutId).toBe("schlicht");
    const draft2 = await createDraftInvoice(orgId, { ...invoiceInput(customer.id) });
    const theme2 = await loadPdfTheme(orgId, draft2.printOptionsJson, "INVOICE");
    expect(theme2.layoutId).toBe("modern");
  });
});

describe("PdfTheme — Phase 12a Task 3: GiroCode-Groesse + Logo-Hoehenbegrenzung", () => {
  it("GiroCode folgt giroSizeMm (Phase 12a): 40 mm rendert auf einer Seite", async () => {
    const theme = testPdfTheme({ options: { ...DEFAULT_PRINT_SETTINGS, giroSizeMm: 40 } });
    const parsed = await parsePdf(await renderInvoicePdf(baseInvoiceData(), theme));
    expect(parsed.text).toContain("GiroCode");
    expect(parsed.numpages).toBe(1);
  });

  it("hohes Logo bei logoWidthMm=140 sprengt die Seite nicht (fit auf 35 mm Hoehe)", async () => {
    const theme = testPdfTheme({ brand: { ...DEFAULT_BRANDING_SETTINGS, logoWidthMm: 140 }, logoBuffer: testPngBuffer(60, 180) });
    const parsed = await parsePdf(await renderInvoicePdf(baseInvoiceData(), theme));
    expect(parsed.numpages).toBe(1);
    expect(parsed.text).toContain("Kunde AG"); // Adressblock nicht vom Logo verdeckt
  });

  it("modern und klassik skalieren das Logo mit logoWidthMm", async () => {
    for (const layoutId of ["modern", "klassik"] as const) {
      const theme = testPdfTheme({ brand: { ...DEFAULT_BRANDING_SETTINGS, logoWidthMm: 120 }, logoBuffer: testPngBuffer(300, 100), layoutId });
      const parsed = await parsePdf(await renderInvoicePdf(baseInvoiceData(), theme));
      expect(parsed.numpages).toBe(1);
      expect(parsed.text).toContain("Kunde AG");
    }
  });
});

describe("PdfTheme — § 14b-Hinweis, Storno-/Korrekturtitel (Phase 12b, Task 5)", () => {
  it("§ 14b-Hinweis steht im PDF, wenn consumerRetentionHint gesetzt ist", async () => {
    const parsed = await parsePdf(await renderInvoicePdf(baseInvoiceData({ consumerRetentionHint: true }), testPdfTheme()));
    expect(parsed.text).toContain("zwei Jahre aufzubewahren");
  });

  it("Storno heisst Stornorechnung, Teilgutschrift heisst Rechnungskorrektur", async () => {
    const storno = await parsePdf(await renderInvoicePdf(baseInvoiceData({ type: "CREDIT_NOTE", creditNoteKind: "STORNO" }), testPdfTheme()));
    expect(storno.text).toContain("Stornorechnung");
    const korrektur = await parsePdf(await renderInvoicePdf(baseInvoiceData({ type: "CREDIT_NOTE", creditNoteKind: "KORREKTUR" }), testPdfTheme()));
    expect(korrektur.text).toContain("Rechnungskorrektur");
    expect(korrektur.text).not.toContain("Gutschrift / Storno");
  });
});
