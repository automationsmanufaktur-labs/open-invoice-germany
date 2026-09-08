import { describe, it, expect } from "vitest";
import { resolveLayoutId, parseLayoutByType, invoiceTypeToLayoutDocType } from "@/domain/settings/layout";
import { freezePrintOptionsJson, DEFAULT_PRINT_SETTINGS } from "@/domain/settings/print";
import { brandingSettingsInputSchema, printOptionsOverrideSchema } from "@/schemas/settings";

describe("resolveLayoutId", () => {
  it("Override > Typ-Map > Organisation > standard", () => {
    expect(resolveLayoutId({ overrideLayoutId: "blau", layoutByType: { INVOICE: "modern" }, orgDefault: "schlicht", docType: "INVOICE" })).toBe("blau");
    expect(resolveLayoutId({ overrideLayoutId: null, layoutByType: { INVOICE: "modern" }, orgDefault: "schlicht", docType: "INVOICE" })).toBe("modern");
    expect(resolveLayoutId({ layoutByType: { INVOICE: "modern" }, orgDefault: "schlicht", docType: "QUOTE" })).toBe("schlicht");
    expect(resolveLayoutId({ layoutByType: {}, orgDefault: "standard", docType: "DUNNING" })).toBe("standard");
  });
  it("parseLayoutByType ist tolerant und filtert Unbekanntes", () => {
    expect(parseLayoutByType(null)).toEqual({});
    expect(parseLayoutByType("kaputt{")).toEqual({});
    expect(parseLayoutByType(JSON.stringify({ INVOICE: "schlicht", FOO: "x", QUOTE: "nope" }))).toEqual({});
    expect(parseLayoutByType(JSON.stringify({ INVOICE: "schlicht" }))).toEqual({ INVOICE: "schlicht" });
  });
  it("invoiceTypeToLayoutDocType", () => {
    expect(invoiceTypeToLayoutDocType("PARTIAL")).toBe("INVOICE");
    expect(invoiceTypeToLayoutDocType("CREDIT_NOTE")).toBe("CREDIT_NOTE");
    expect(invoiceTypeToLayoutDocType("AUFTRAGSBESTAETIGUNG")).toBe("ORDER_CONFIRMATION");
    expect(invoiceTypeToLayoutDocType("ANGEBOT")).toBe("QUOTE");
    expect(invoiceTypeToLayoutDocType("PROFORMA")).toBe("PROFORMA");
    expect(invoiceTypeToLayoutDocType("unbekannt")).toBe("INVOICE");
  });
});

describe("Zod: Branding + Override", () => {
  it("Defaults: layoutId standard, layoutByType {}, footerMode AUTO", () => {
    const b = brandingSettingsInputSchema.parse({});
    expect(b.layoutId).toBe("standard");
    expect(b.layoutByType).toEqual({});
    expect(b.footerMode).toBe("AUTO");
  });
  it("lehnt unbekannte layoutId, unbekannten Belegtyp und footerMode ab", () => {
    expect(brandingSettingsInputSchema.safeParse({ layoutId: "premium" }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ layoutByType: { INVOICE: "gibtsnicht" } }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ layoutByType: { FOO: "standard" } }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ footerMode: "BOTH" }).success).toBe(false);
    expect(printOptionsOverrideSchema.safeParse({ layoutId: "kompakt" }).success).toBe(true);
    expect(printOptionsOverrideSchema.safeParse({ layoutId: "x" }).success).toBe(false);
  });
});

describe("freezePrintOptionsJson mit layoutId", () => {
  it("ergaenzt layoutId, wenn er fehlt — auch bei vollstaendigen Schaltern", () => {
    const full = JSON.stringify(DEFAULT_PRINT_SETTINGS);
    const frozen = JSON.parse(freezePrintOptionsJson(DEFAULT_PRINT_SETTINGS, full, "schlicht")) as { layoutId?: string };
    expect(frozen.layoutId).toBe("schlicht");
  });
  it("laesst einen vorhandenen layoutId unveraendert", () => {
    const existing = JSON.stringify({ ...DEFAULT_PRINT_SETTINGS, layoutId: "blau" });
    expect(freezePrintOptionsJson(DEFAULT_PRINT_SETTINGS, existing, "schlicht")).toBe(existing);
  });
  it("ein vollstaendiger, layoutId-loser Override behaelt seine (nicht-default) Schalter und bekommt den uebergebenen layoutId", () => {
    const complete = JSON.stringify({ ...DEFAULT_PRINT_SETTINGS, showGiroCode: false });
    const frozen = JSON.parse(freezePrintOptionsJson(DEFAULT_PRINT_SETTINGS, complete, "blau")) as { showGiroCode: boolean; layoutId: string };
    expect(frozen.showGiroCode).toBe(false);
    expect(frozen.layoutId).toBe("blau");
  });
});
