import { describe, it, expect } from "vitest";
import { formatDocumentNumber, defaultPrefix } from "@/domain/numbering";

describe("numbering", () => {
  it("formatiert das Standard-Pattern", () => {
    expect(
      formatDocumentNumber("{PREFIX}{YYYY}-{SEQ}", { prefix: "RE-", seq: 7, padding: 4, year: 2026, month: 6, day: 1 }),
    ).toBe("RE-2026-0007");
  });

  it("unterstützt Kurzjahr + Monat", () => {
    expect(
      formatDocumentNumber("{PREFIX}{YY}{MM}-{SEQ}", { prefix: "X", seq: 42, padding: 3, year: 2026, month: 6, day: 1 }),
    ).toBe("X2606-042");
  });

  it("liefert Default-Präfixe je Belegart", () => {
    expect(defaultPrefix("INVOICE")).toBe("RE-");
    expect(defaultPrefix("CREDIT_NOTE")).toBe("GS-");
  });

  it("unterstuetzt {SEQ:n} mit expliziter Stellenzahl und {DD}", () => {
    expect(
      formatDocumentNumber("{PREFIX}{YYYY}-{SEQ:5}", { prefix: "LS-", seq: 7, padding: 4, year: 2026, month: 9, day: 3 }),
    ).toBe("LS-2026-00007");
    expect(
      formatDocumentNumber("{YYYY}{MM}{DD}-{SEQ:2}", { prefix: "", seq: 3, padding: 4, year: 2026, month: 9, day: 3 }),
    ).toBe("20260903-03");
  });

  it("{SEQ} ohne Stellenangabe nutzt weiterhin padding", () => {
    expect(formatDocumentNumber("{SEQ}", { prefix: "", seq: 7, padding: 4, year: 2026, month: 1, day: 1 })).toBe("0007");
  });

  it("kennt Praefixe fuer Lieferschein, Kunde, Produkt", () => {
    expect(defaultPrefix("DELIVERY_NOTE")).toBe("LS-");
    expect(defaultPrefix("CUSTOMER")).toBe("K-");
    expect(defaultPrefix("PRODUCT")).toBe("P-");
  });
});
