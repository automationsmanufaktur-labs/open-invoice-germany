import { describe, it, expect } from "vitest";
import { nextDiscountOnCustomerChange } from "@/lib/forms/discount-prefill";

describe("nextDiscountOnCustomerChange (Fix-Welle B6)", () => {
  it("leeres Feld -> wird auf den neuen Default gesetzt", () => {
    expect(nextDiscountOnCustomerChange("", "", "5")).toEqual({ apply: true, value: "5" });
  });

  it("Feld entspricht noch dem zuletzt automatisch angewendeten Default -> wird ueberschrieben (zweiter Kundenwechsel)", () => {
    // Kunde A hatte 5% Default, Nutzer hat nichts geaendert; Kunde B hat 10% Default.
    expect(nextDiscountOnCustomerChange("5", "5", "10")).toEqual({ apply: true, value: "10" });
  });

  it("Feld weicht vom zuletzt angewendeten Default ab (Nutzer hat selbst editiert) -> bleibt unangetastet", () => {
    expect(nextDiscountOnCustomerChange("7", "5", "10")).toEqual({ apply: false });
  });

  it("neuer Kunde ohne Default (leerer String) ueberschreibt trotzdem, wenn das Feld noch dem alten Default entspricht", () => {
    expect(nextDiscountOnCustomerChange("5", "5", "")).toEqual({ apply: true, value: "" });
  });
});
