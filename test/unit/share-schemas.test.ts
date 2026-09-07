import { describe, it, expect } from "vitest";
import {
  OnQuoteAccept,
  documentSettingsInputSchema,
  createShareLinkInputSchema,
  decideOfferInputSchema,
} from "@/schemas";

describe("OnQuoteAccept", () => {
  it("akzeptiert NONE/ORDER_CONFIRMATION/INVOICE", () => {
    for (const v of ["NONE", "ORDER_CONFIRMATION", "INVOICE"]) {
      expect(OnQuoteAccept.safeParse(v).success).toBe(true);
    }
    expect(OnQuoteAccept.safeParse("SONSTIGES").success).toBe(false);
  });
});

describe("documentSettingsInputSchema", () => {
  it("setzt Defaults bei leerem Objekt", () => {
    // Phase 7, Task 1 erweitert documentSettingsInputSchema um weitere Felder (siehe
    // test/unit/settings-schemas.test.ts fuer die vollstaendige Default-Pruefung) —
    // hier bleibt nur die urspruengliche Drei-Felder-Pruefung (Teilmenge).
    const parsed = documentSettingsInputSchema.parse({});
    expect(parsed).toMatchObject({ onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: false });
  });

  it("lehnt shareLinkDays ausserhalb 1..365 ab", () => {
    expect(documentSettingsInputSchema.safeParse({ shareLinkDays: 0 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ shareLinkDays: 366 }).success).toBe(false);
    expect(documentSettingsInputSchema.safeParse({ shareLinkDays: 365 }).success).toBe(true);
  });
});

describe("createShareLinkInputSchema", () => {
  it("expiresInDays ist optional", () => {
    expect(createShareLinkInputSchema.parse({})).toEqual({});
  });

  it("lehnt Werte ausserhalb 1..365 ab", () => {
    expect(createShareLinkInputSchema.safeParse({ expiresInDays: 0 }).success).toBe(false);
    expect(createShareLinkInputSchema.safeParse({ expiresInDays: 90 }).success).toBe(true);
  });
});

describe("decideOfferInputSchema", () => {
  it("verlangt einen nicht-leeren Namen", () => {
    expect(decideOfferInputSchema.safeParse({ decision: "ACCEPTED", name: "", email: "max@example.com" }).success).toBe(false);
    expect(decideOfferInputSchema.safeParse({ decision: "ACCEPTED", name: "A", email: "max@example.com" }).success).toBe(true);
  });

  it("E-Mail ist optional (W1) — fehlend oder leer ist gueltig, ein angegebener Wert muss aber eine echte Adresse sein", () => {
    const ohneEmail = decideOfferInputSchema.safeParse({ decision: "ACCEPTED", name: "Max Muster" });
    expect(ohneEmail.success).toBe(true);
    if (ohneEmail.success) expect(ohneEmail.data.email).toBeUndefined();

    const leereEmail = decideOfferInputSchema.safeParse({ decision: "ACCEPTED", name: "Max Muster", email: "" });
    expect(leereEmail.success).toBe(true);
    if (leereEmail.success) expect(leereEmail.data.email).toBeUndefined();

    expect(
      decideOfferInputSchema.safeParse({ decision: "ACCEPTED", name: "Max Muster", email: "keine-email" }).success,
    ).toBe(false);
    expect(
      decideOfferInputSchema.safeParse({ decision: "ACCEPTED", name: "Max Muster", email: "max@example.com" })
        .success,
    ).toBe(true);
  });

  it("begrenzt den Kommentar auf 2000 Zeichen", () => {
    const ok = decideOfferInputSchema.safeParse({
      decision: "REJECTED",
      name: "Max Muster",
      email: "max@example.com",
      comment: "x".repeat(2000),
    });
    expect(ok.success).toBe(true);

    const zuLang = decideOfferInputSchema.safeParse({
      decision: "REJECTED",
      name: "Max Muster",
      email: "max@example.com",
      comment: "x".repeat(2001),
    });
    expect(zuLang.success).toBe(false);
  });

  it("lehnt eine unbekannte decision ab", () => {
    expect(
      decideOfferInputSchema.safeParse({ decision: "MAYBE", name: "Max Muster", email: "max@example.com" }).success,
    ).toBe(false);
  });
});
