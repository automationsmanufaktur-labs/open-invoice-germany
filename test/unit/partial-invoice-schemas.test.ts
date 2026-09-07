import { describe, it, expect } from "vitest";
import {
  InvoiceType,
  createPartialInvoiceSchema,
  createDownpaymentInvoiceSchema,
  createFinalInvoiceSchema,
} from "@/schemas";

describe("InvoiceType", () => {
  it("kennt PARTIAL/DOWNPAYMENT/FINAL zusaetzlich zu INVOICE/CREDIT_NOTE/CORRECTION", () => {
    for (const t of ["INVOICE", "CREDIT_NOTE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]) {
      expect(InvoiceType.safeParse(t).success).toBe(true);
    }
    expect(InvoiceType.safeParse("OTHER").success).toBe(false);
  });
});

describe("createPartialInvoiceSchema", () => {
  it("mode PERCENT braucht permille", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "PERCENT" as const };
    expect(createPartialInvoiceSchema.safeParse(base).success).toBe(false);
    expect(createPartialInvoiceSchema.safeParse({ ...base, permille: 300 }).success).toBe(true);
  });

  it("mode NET_AMOUNT/GROSS_AMOUNT braucht amountCents", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "NET_AMOUNT" as const };
    expect(createPartialInvoiceSchema.safeParse(base).success).toBe(false);
    expect(createPartialInvoiceSchema.safeParse({ ...base, amountCents: 100_000 }).success).toBe(true);
    expect(
      createPartialInvoiceSchema.safeParse({ ...base, mode: "GROSS_AMOUNT", amountCents: 100_000 }).success,
    ).toBe(true);
  });

  it("mode POSITIONS braucht lineIds", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "POSITIONS" as const };
    expect(createPartialInvoiceSchema.safeParse(base).success).toBe(false);
    expect(createPartialInvoiceSchema.safeParse({ ...base, lineIds: ["l1"] }).success).toBe(true);
  });

  it("mode QUANTITIES braucht quantities", () => {
    const base = { sourceType: "DELIVERY_NOTE" as const, sourceId: "d1", mode: "QUANTITIES" as const };
    expect(createPartialInvoiceSchema.safeParse(base).success).toBe(false);
    expect(
      createPartialInvoiceSchema.safeParse({
        ...base,
        quantities: [{ sourceLineId: "l1", quantityMilli: 1000 }],
      }).success,
    ).toBe(true);
  });

  it("sourceType akzeptiert nur QUOTE/DELIVERY_NOTE", () => {
    expect(
      createPartialInvoiceSchema.safeParse({
        sourceType: "INVOICE",
        sourceId: "i1",
        mode: "PERCENT",
        permille: 300,
      }).success,
    ).toBe(false);
  });

  it("permille 0 wird abgelehnt, 1 akzeptiert (untere Grenze)", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "PERCENT" as const };
    expect(createPartialInvoiceSchema.safeParse({ ...base, permille: 0 }).success).toBe(false);
    expect(createPartialInvoiceSchema.safeParse({ ...base, permille: 1 }).success).toBe(true);
  });

  it("permille 1001 wird abgelehnt, 1000 akzeptiert (obere Grenze)", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "PERCENT" as const };
    expect(createPartialInvoiceSchema.safeParse({ ...base, permille: 1001 }).success).toBe(false);
    expect(createPartialInvoiceSchema.safeParse({ ...base, permille: 1000 }).success).toBe(true);
  });

  it("amountCents 0 wird abgelehnt", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "NET_AMOUNT" as const };
    expect(createPartialInvoiceSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });

  it("negativer amountCents wird abgelehnt", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "NET_AMOUNT" as const };
    expect(createPartialInvoiceSchema.safeParse({ ...base, amountCents: -1 }).success).toBe(false);
  });

  it("leere lineIds werden abgelehnt", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "POSITIONS" as const };
    expect(createPartialInvoiceSchema.safeParse({ ...base, lineIds: [] }).success).toBe(false);
  });

  it("leere quantities werden abgelehnt", () => {
    const base = { sourceType: "DELIVERY_NOTE" as const, sourceId: "d1", mode: "QUANTITIES" as const };
    expect(createPartialInvoiceSchema.safeParse({ ...base, quantities: [] }).success).toBe(false);
  });

  it("quantityMilli 0 in einer quantities-Zeile wird abgelehnt", () => {
    const base = { sourceType: "DELIVERY_NOTE" as const, sourceId: "d1", mode: "QUANTITIES" as const };
    expect(
      createPartialInvoiceSchema.safeParse({
        ...base,
        quantities: [{ sourceLineId: "l1", quantityMilli: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe("createDownpaymentInvoiceSchema", () => {
  it("mode PERCENT braucht permille", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "PERCENT" as const };
    expect(createDownpaymentInvoiceSchema.safeParse(base).success).toBe(false);
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, permille: 300 }).success).toBe(true);
  });

  it("mode AMOUNT braucht amountCents, amountIsGross defaultet auf false", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "AMOUNT" as const };
    expect(createDownpaymentInvoiceSchema.safeParse(base).success).toBe(false);
    const parsed = createDownpaymentInvoiceSchema.parse({ ...base, amountCents: 50_000 });
    expect(parsed.amountIsGross).toBe(false);
  });

  it("amountIsGross kann explizit true gesetzt werden", () => {
    const parsed = createDownpaymentInvoiceSchema.parse({
      sourceType: "QUOTE",
      sourceId: "q1",
      mode: "AMOUNT",
      amountCents: 50_000,
      amountIsGross: true,
    });
    expect(parsed.amountIsGross).toBe(true);
  });

  it("permille 0 wird abgelehnt, 1 akzeptiert (untere Grenze)", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "PERCENT" as const };
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, permille: 0 }).success).toBe(false);
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, permille: 1 }).success).toBe(true);
  });

  it("permille 1001 wird abgelehnt, 1000 akzeptiert (obere Grenze)", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "PERCENT" as const };
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, permille: 1001 }).success).toBe(false);
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, permille: 1000 }).success).toBe(true);
  });

  it("amountCents 0 wird abgelehnt", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "AMOUNT" as const };
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });

  it("negativer amountCents wird abgelehnt", () => {
    const base = { sourceType: "QUOTE" as const, sourceId: "q1", mode: "AMOUNT" as const };
    expect(createDownpaymentInvoiceSchema.safeParse({ ...base, amountCents: -1 }).success).toBe(false);
  });
});

describe("createFinalInvoiceSchema", () => {
  it("verlangt sourceType QUOTE und sourceId", () => {
    expect(createFinalInvoiceSchema.safeParse({ sourceType: "QUOTE", sourceId: "q1" }).success).toBe(true);
    expect(createFinalInvoiceSchema.safeParse({ sourceType: "DELIVERY_NOTE", sourceId: "q1" }).success).toBe(
      false,
    );
    expect(createFinalInvoiceSchema.safeParse({ sourceType: "QUOTE" }).success).toBe(false);
  });
});
