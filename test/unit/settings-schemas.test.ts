import { describe, it, expect } from "vitest";
import {
  documentSettingsInputSchema,
  printSettingsInputSchema,
  printOptionsOverrideSchema,
  brandingSettingsInputSchema,
  numberRangeInputSchema,
  NUMBER_RANGE_DOC_TYPES,
} from "@/schemas";

describe("documentSettingsInputSchema (Phase 7, Task 1 — erweiterte Felder)", () => {
  it("setzt Defaults fuer alle neuen Felder bei leerem Objekt", () => {
    const parsed = documentSettingsInputSchema.parse({});
    expect(parsed).toEqual({
      onQuoteAccept: "NONE",
      shareLinkDays: 30,
      storeAcceptIp: false,
      autoFinalizeOnSend: false,
      defaultCurrency: "EUR",
      quoteValidityDays: 30,
      shareLinkDefaultOn: true,
      dnShowPrices: false,
      dnShowArticleNumber: true,
      dnShowDeliveryAddress: true,
      invoiceDueDays: 14,
      showPaymentTermsText: true,
      autoDeliveryDate: true,
      refreshIssueDateOnFinalize: true,
      offerLastDocument: true,
      eInvoiceDefault: true,
      defaultPaymentMethodId: null,
      recurringInsertPeriodText: true,
      recurringAutoFinalizeDefault: false,
      recurringAutoSendDefault: false,
    });
  });

  it("lehnt Tage ausserhalb 0..365 ab (quoteValidityDays, invoiceDueDays)", () => {
    expect(documentSettingsInputSchema.safeParse({ quoteValidityDays: -1 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ quoteValidityDays: 366 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ quoteValidityDays: 0 }).success).toBe(true);
    expect(documentSettingsInputSchema.safeParse({ quoteValidityDays: 365 }).success).toBe(true);
    expect(documentSettingsInputSchema.safeParse({ invoiceDueDays: -1 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ invoiceDueDays: 366 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ invoiceDueDays: 0 }).success).toBe(true);
  });

  it("shareLinkDays bleibt bei 1..365 (unveraendertes Verhalten)", () => {
    expect(documentSettingsInputSchema.safeParse({ shareLinkDays: 0 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ shareLinkDays: 366 }).success).toBe(false);
  });

  it("verlangt eine 3-stellige Grossbuchstaben-Waehrung", () => {
    expect(documentSettingsInputSchema.safeParse({ defaultCurrency: "EUR" }).success).toBe(true);
    expect(documentSettingsInputSchema.safeParse({ defaultCurrency: "eur" }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ defaultCurrency: "EURO" }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ defaultCurrency: "12" }).success).toBe(false);
  });

  it("defaultPaymentMethodId akzeptiert null oder eine ID", () => {
    expect(documentSettingsInputSchema.parse({ defaultPaymentMethodId: null }).defaultPaymentMethodId).toBeNull();
    expect(documentSettingsInputSchema.parse({ defaultPaymentMethodId: "pm1" }).defaultPaymentMethodId).toBe("pm1");
  });
});

describe("printSettingsInputSchema", () => {
  it("setzt die zehn Default-Schalter", () => {
    expect(printSettingsInputSchema.parse({})).toEqual({
      showFooter: true,
      showPageNumbers: true,
      foldMarks: false,
      punchMarks: false,
      showArticleNumber: true,
      showDescription: true,
      showTaxRatePerLine: true,
      showLineTotals: true,
      showSenderLine: true,
      showGiroCode: true,
    });
  });

  it("lehnt einen unbekannten Boolean-Wert ab", () => {
    expect(printSettingsInputSchema.safeParse({ showFooter: "yes" }).success).toBe(false);
  });
});

describe("printOptionsOverrideSchema", () => {
  it("ist eine Partial-Version von printSettingsInputSchema — alle Felder optional, keine Defaults", () => {
    expect(printOptionsOverrideSchema.parse({})).toEqual({});
    expect(printOptionsOverrideSchema.parse({ showFooter: false })).toEqual({ showFooter: false });
  });
});

describe("brandingSettingsInputSchema", () => {
  it("setzt Defaults bei leerem Objekt", () => {
    expect(brandingSettingsInputSchema.parse({})).toEqual({
      logoPath: null,
      logoWidthMm: 40,
      primaryColor: "#111111",
      senderLine: null,
      footerLeft: null,
      footerCenter: null,
      footerRight: null,
      marginTopMm: 20,
      marginRightMm: 18,
      marginBottomMm: 20,
      marginLeftMm: 18,
      fontSizePt: 10,
      backgroundPath: null,
      showBackground: false,
    });
  });

  it("prueft die Farbe als #RRGGBB-Hex-Code", () => {
    expect(brandingSettingsInputSchema.safeParse({ primaryColor: "#ABCDEF" }).success).toBe(true);
    expect(brandingSettingsInputSchema.safeParse({ primaryColor: "#abc" }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ primaryColor: "111111" }).success).toBe(false);
  });

  it("begrenzt logoWidthMm auf 10..100", () => {
    expect(brandingSettingsInputSchema.safeParse({ logoWidthMm: 9 }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ logoWidthMm: 10 }).success).toBe(true);
    expect(brandingSettingsInputSchema.safeParse({ logoWidthMm: 100 }).success).toBe(true);
    expect(brandingSettingsInputSchema.safeParse({ logoWidthMm: 101 }).success).toBe(false);
  });

  it("begrenzt die Raender auf 5..40", () => {
    for (const field of ["marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm"]) {
      expect(brandingSettingsInputSchema.safeParse({ [field]: 4 }).success).toBe(false);
      expect(brandingSettingsInputSchema.safeParse({ [field]: 41 }).success).toBe(false);
      expect(brandingSettingsInputSchema.safeParse({ [field]: 5 }).success).toBe(true);
      expect(brandingSettingsInputSchema.safeParse({ [field]: 40 }).success).toBe(true);
    }
  });

  it("begrenzt fontSizePt auf 8..14", () => {
    expect(brandingSettingsInputSchema.safeParse({ fontSizePt: 7 }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ fontSizePt: 15 }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ fontSizePt: 8 }).success).toBe(true);
  });

  it("begrenzt senderLine auf 200 und Fusszeilen auf 500 Zeichen", () => {
    expect(brandingSettingsInputSchema.safeParse({ senderLine: "x".repeat(200) }).success).toBe(true);
    expect(brandingSettingsInputSchema.safeParse({ senderLine: "x".repeat(201) }).success).toBe(false);
    expect(brandingSettingsInputSchema.safeParse({ footerLeft: "x".repeat(500) }).success).toBe(true);
    expect(brandingSettingsInputSchema.safeParse({ footerLeft: "x".repeat(501) }).success).toBe(false);
  });
});

describe("numberRangeInputSchema", () => {
  it("verlangt einen {SEQ}- oder {SEQ:n}-Platzhalter im Muster", () => {
    expect(numberRangeInputSchema.safeParse({ pattern: "RE-{YYYY}-{SEQ}", nextValue: 1 }).success).toBe(true);
    expect(numberRangeInputSchema.safeParse({ pattern: "RE-{YYYY}-{SEQ:5}", nextValue: 1 }).success).toBe(true);
    expect(numberRangeInputSchema.safeParse({ pattern: "RE-{YYYY}", nextValue: 1 }).success).toBe(false);
  });

  it("setzt Defaults fuer prefix/seqPadding/yearlyReset", () => {
    const parsed = numberRangeInputSchema.parse({ pattern: "{PREFIX}{SEQ}", nextValue: 1 });
    expect(parsed.prefix).toBe("");
    expect(parsed.seqPadding).toBe(4);
    expect(parsed.yearlyReset).toBe(false);
  });

  it("begrenzt prefix auf 10 und seqPadding auf 1..8", () => {
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", prefix: "x".repeat(10), nextValue: 1 }).success).toBe(true);
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", prefix: "x".repeat(11), nextValue: 1 }).success).toBe(false);
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", seqPadding: 0, nextValue: 1 }).success).toBe(false);
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", seqPadding: 9, nextValue: 1 }).success).toBe(false);
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", seqPadding: 8, nextValue: 1 }).success).toBe(true);
  });

  it("verlangt nextValue >= 1", () => {
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", nextValue: 0 }).success).toBe(false);
    expect(numberRangeInputSchema.safeParse({ pattern: "{SEQ}", nextValue: 1 }).success).toBe(true);
  });

  it("kennt alle neun Nummernkreis-Typen", () => {
    expect(NUMBER_RANGE_DOC_TYPES).toEqual([
      "CUSTOMER",
      "PRODUCT",
      "ANGEBOT",
      "AUFTRAGSBESTAETIGUNG",
      "PROFORMA",
      "DELIVERY_NOTE",
      "INVOICE",
      "CREDIT_NOTE",
      "DUNNING",
    ]);
  });
});

describe("Schemadateien SQLite/Postgres (CI schema-drift)", () => {
  it("sind bis auf die provider-Zeile identisch", async () => {
    const { readFileSync } = await import("node:fs");
    const sqlite = readFileSync("prisma/schema.prisma", "utf-8").replace('provider = "sqlite"', "PROVIDER");
    const postgres = readFileSync("prisma/schema.postgres.prisma", "utf-8").replace('provider = "postgresql"', "PROVIDER");
    expect(postgres).toBe(sqlite);
  });
});
