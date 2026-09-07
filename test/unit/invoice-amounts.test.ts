import { describe, it, expect } from "vitest";
import { openAmountCents, payableBaseCents } from "@/domain/invoice/amounts";

describe("payableBaseCents/openAmountCents (Phase 5 — Schlussrechnung-Bemessungsgrundlage)", () => {
  it("nutzt grossTotalCents, wenn payableCents NULL ist (normale Rechnung/Teil-/Abschlagsrechnung)", () => {
    const inv = { grossTotalCents: 119_000, payableCents: null, paidAmountCents: 0 };
    expect(payableBaseCents(inv)).toBe(119_000);
    expect(openAmountCents(inv)).toBe(119_000);
  });

  it("nutzt payableCents statt grossTotalCents, wenn gesetzt (Schlussrechnung)", () => {
    // Lastenheft-Beispiel: Gesamtleistung brutto 11.900, zwei Abschlaege a 3.570 -> Rest 4.760.
    const inv = { grossTotalCents: 1_190_000, payableCents: 476_000, paidAmountCents: 0 };
    expect(payableBaseCents(inv)).toBe(476_000);
    expect(openAmountCents(inv)).toBe(476_000);
  });

  it("zieht bereits erfasste Zahlungen von der Bemessungsgrundlage ab", () => {
    const inv = { grossTotalCents: 1_190_000, payableCents: 476_000, paidAmountCents: 476_000 };
    expect(openAmountCents(inv)).toBe(0);
  });
});
