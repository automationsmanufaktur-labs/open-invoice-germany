import { describe, it, expect } from "vitest";
import { createInvoiceSchema } from "@/schemas";

/**
 * G-Refine — Skonto 2 muss ein GUENSTIGERES Ziel als Skonto 1 sein: niedrigerer
 * Prozentsatz UND laengere Frist. Ohne diese Regel liess sich ein wirtschaftlich
 * widersinniges Ziel 2 (hoeherer/gleicher Satz bei laengerer Frist) eintragen.
 */
describe("createInvoiceSchema — Skonto-Ziele (G-Refine)", () => {
  const base = {
    customerId: "cust-1",
    lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
  };

  it("gueltiges Ziel 2 (niedrigerer Satz, laengere Frist)", () => {
    const result = createInvoiceSchema.safeParse({
      ...base,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: 10,
      skonto2Days: 14,
    });
    expect(result.success).toBe(true);
  });

  it("Ziel 2 mit GLEICHEM Prozentsatz wird abgelehnt", () => {
    const result = createInvoiceSchema.safeParse({
      ...base,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: 20,
      skonto2Days: 14,
    });
    expect(result.success).toBe(false);
  });

  it("Ziel 2 mit HOEHEREM Prozentsatz wird abgelehnt", () => {
    const result = createInvoiceSchema.safeParse({
      ...base,
      skonto1Permille: 10,
      skonto1Days: 7,
      skonto2Permille: 20,
      skonto2Days: 14,
    });
    expect(result.success).toBe(false);
  });
});
