import { describe, it, expect } from "vitest";
import { SYSTEM_PAYMENT_METHODS, DEFAULT_DUNNING_STAGES } from "@/domain/masterdata/defaults";
import { PaymentMethod, RelationType, DocType } from "@/schemas";

describe("Stammdaten-Defaults", () => {
  it("acht Systemzahlungsmethoden mit eindeutigen Codes und UNTDID-4461-Codes", () => {
    expect(SYSTEM_PAYMENT_METHODS).toHaveLength(8);
    expect(new Set(SYSTEM_PAYMENT_METHODS.map((m) => m.code)).size).toBe(8);
    for (const code of ["TRANSFER", "CASH", "CARD", "SEPA"]) {
      expect(SYSTEM_PAYMENT_METHODS.some((m) => m.code === code)).toBe(true); // Altcodes bleiben aufloesbar
    }
    expect(SYSTEM_PAYMENT_METHODS.find((m) => m.code === "TRANSFER")!.untdidCode).toBe("58");
    expect(SYSTEM_PAYMENT_METHODS.find((m) => m.code === "SEPA")!.untdidCode).toBe("59");
  });

  it("vier Standard-Mahnstufen, Zins und B2B-Pauschale ab Stufe 1", () => {
    expect(DEFAULT_DUNNING_STAGES.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(DEFAULT_DUNNING_STAGES[0].calculateInterest).toBe(false);
    expect(DEFAULT_DUNNING_STAGES[1].calculateInterest).toBe(true);
    expect(DEFAULT_DUNNING_STAGES[1].includeB2BFlatFee).toBe(true);
    expect(DEFAULT_DUNNING_STAGES[0].name).toBe("Zahlungserinnerung");
  });

  it("Zod: PaymentMethod ist ein String, DocType kennt die realen Belegarten", () => {
    expect(PaymentMethod.safeParse("PAYPAL").success).toBe(true);
    expect(PaymentMethod.safeParse("").success).toBe(false);
    expect(DocType.safeParse("DELIVERY_NOTE").success).toBe(true);
    expect(DocType.safeParse("ANGEBOT").success).toBe(true);
    expect(DocType.safeParse("QUOTE").success).toBe(false);
    expect(RelationType.safeParse("CONVERTED_TO").success).toBe(true);
  });
});
