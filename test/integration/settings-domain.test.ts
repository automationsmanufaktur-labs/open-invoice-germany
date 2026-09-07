/**
 * Phase 7, Task 1 — Settings-Domain (print.ts, branding.ts) + setPrintOptions-Guard.
 */
import { describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { loadPrintSettings, savePrintSettings, effectivePrintOptions, setPrintOptions, DEFAULT_PRINT_SETTINGS } from "@/domain/settings/print";
import { loadBrandingSettings, saveBrandingSettings, DEFAULT_BRANDING_SETTINGS } from "@/domain/settings/branding";
import { InvalidOperationError, NotFoundError } from "@/domain/errors";

async function makeOrg() {
  const org = await dbInternal.organization.create({
    data: { legalName: "Settings Test GmbH", addressLine1: "Teststr. 1", postalCode: "12345", city: "Berlin" },
  });
  return org.id;
}

async function makeCustomer(orgId: string) {
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde Settings", addressLine1: "Kundenweg 1", postalCode: "10115", city: "Berlin" },
  });
  return customer.id;
}

describe("Phase 7 — PrintSettings-Domain (Selbstheilung analog DocumentSettings)", () => {
  it("liefert Defaults ohne gespeicherte Zeile; speichert und laedt danach die gesetzten Werte", async () => {
    const orgId = await makeOrg();
    const defaults = await loadPrintSettings(orgId);
    expect(defaults).toEqual(DEFAULT_PRINT_SETTINGS);

    await savePrintSettings(orgId, { showFooter: false, showGiroCode: false });
    const loaded = await loadPrintSettings(orgId);
    expect(loaded.showFooter).toBe(false);
    expect(loaded.showGiroCode).toBe(false);
    expect(loaded.showPageNumbers).toBe(true); // unveraendert (Default)
  });
});

describe("Phase 7 — BrandingSettings-Domain (Selbstheilung analog DocumentSettings)", () => {
  it("liefert Defaults ohne gespeicherte Zeile; speichert und laedt danach die gesetzten Werte", async () => {
    const orgId = await makeOrg();
    const defaults = await loadBrandingSettings(orgId);
    expect(defaults).toEqual(DEFAULT_BRANDING_SETTINGS);

    await saveBrandingSettings(orgId, { primaryColor: "#ABCDEF", logoWidthMm: 60 });
    const loaded = await loadBrandingSettings(orgId);
    expect(loaded.primaryColor).toBe("#ABCDEF");
    expect(loaded.logoWidthMm).toBe(60);
  });

  it("lehnt eine ungueltige Farbe ab", async () => {
    const orgId = await makeOrg();
    await expect(saveBrandingSettings(orgId, { primaryColor: "rot" })).rejects.toThrow();
  });
});

describe("Phase 7 — effectivePrintOptions (rein)", () => {
  it("liefert das globale Ergebnis ohne Override", () => {
    expect(effectivePrintOptions(DEFAULT_PRINT_SETTINGS, null)).toEqual(DEFAULT_PRINT_SETTINGS);
    expect(effectivePrintOptions(DEFAULT_PRINT_SETTINGS, undefined)).toEqual(DEFAULT_PRINT_SETTINGS);
  });

  it("verschmilzt nur die im Override gesetzten Felder", () => {
    const merged = effectivePrintOptions(DEFAULT_PRINT_SETTINGS, JSON.stringify({ showFooter: false, showGiroCode: false }));
    expect(merged).toEqual({ ...DEFAULT_PRINT_SETTINGS, showFooter: false, showGiroCode: false });
  });

  it("ignoriert ein kaputtes JSON und liefert die globalen Optionen", () => {
    expect(effectivePrintOptions(DEFAULT_PRINT_SETTINGS, "{kaputt")).toEqual(DEFAULT_PRINT_SETTINGS);
  });
});

describe("Phase 7 — setPrintOptions (nur bei status DRAFT)", () => {
  it("setzt die Ueberschreibung auf einer Rechnung im Entwurf", async () => {
    const orgId = await makeOrg();
    const customerId = await makeCustomer(orgId);
    const invoice = await dbInternal.invoice.create({
      data: { orgId, customerId, status: "DRAFT" },
    });

    const result = await setPrintOptions(orgId, { kind: "INVOICE", id: invoice.id }, { showGiroCode: false });
    expect(result).toEqual({ showGiroCode: false });

    const updated = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(JSON.parse(updated.printOptionsJson!)).toEqual({ showGiroCode: false });
  });

  it("lehnt eine festgeschriebene Rechnung ab (InvalidOperationError, kein GoBD-Bypass)", async () => {
    const orgId = await makeOrg();
    const customerId = await makeCustomer(orgId);
    const invoice = await dbInternal.invoice.create({
      data: { orgId, customerId, status: "FINALIZED", number: `RE-2055-${orgId}` },
    });

    await expect(setPrintOptions(orgId, { kind: "INVOICE", id: invoice.id }, { showGiroCode: false })).rejects.toThrow(
      InvalidOperationError,
    );

    const unchanged = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(unchanged.printOptionsJson).toBeNull();
  });

  it("setzt die Ueberschreibung auf einem Angebot im Entwurf, lehnt SENT ab", async () => {
    const orgId = await makeOrg();
    const customerId = await makeCustomer(orgId);
    const quoteDraft = await dbInternal.quote.create({ data: { orgId, customerId, status: "DRAFT" } });
    const quoteSent = await dbInternal.quote.create({ data: { orgId, customerId, status: "SENT" } });

    await setPrintOptions(orgId, { kind: "QUOTE", id: quoteDraft.id }, { showFooter: false });
    const updated = await dbInternal.quote.findUniqueOrThrow({ where: { id: quoteDraft.id } });
    expect(JSON.parse(updated.printOptionsJson!)).toEqual({ showFooter: false });

    await expect(setPrintOptions(orgId, { kind: "QUOTE", id: quoteSent.id }, { showFooter: false })).rejects.toThrow(
      InvalidOperationError,
    );
  });

  it("setzt die Ueberschreibung auf einem Lieferschein im Entwurf, lehnt CREATED ab", async () => {
    const orgId = await makeOrg();
    const customerId = await makeCustomer(orgId);
    const dnDraft = await dbInternal.deliveryNote.create({ data: { orgId, customerId, status: "DRAFT" } });
    const dnCreated = await dbInternal.deliveryNote.create({ data: { orgId, customerId, status: "CREATED" } });

    await setPrintOptions(orgId, { kind: "DELIVERY_NOTE", id: dnDraft.id }, { showArticleNumber: false });
    const updated = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: dnDraft.id } });
    expect(JSON.parse(updated.printOptionsJson!)).toEqual({ showArticleNumber: false });

    await expect(
      setPrintOptions(orgId, { kind: "DELIVERY_NOTE", id: dnCreated.id }, { showArticleNumber: false }),
    ).rejects.toThrow(InvalidOperationError);
  });

  it("wirft NotFoundError bei unbekannter ID", async () => {
    const orgId = await makeOrg();
    await expect(setPrintOptions(orgId, { kind: "INVOICE", id: "unbekannt" }, {})).rejects.toThrow(NotFoundError);
  });
});
