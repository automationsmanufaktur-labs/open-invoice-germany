import { describe, it, expect } from "vitest";
import { initialDiscountMode } from "@/components/editor/blocks/LineDiscountField";

describe("editor/LineDiscountField initialDiscountMode", () => {
  it("beide leer -> percent", () => {
    expect(initialDiscountMode({ discountPercent: "", discountAmount: "" })).toBe("percent");
  });
  it("literale Nullen -> percent", () => {
    expect(initialDiscountMode({ discountPercent: "0", discountAmount: "0" })).toBe("percent");
  });
  // Fix 3 (Task-5-Review): `fromCents(0)`/`fromPermille(0)` formatieren einen echten
  // Nullwert als "0,00"/"0,0" statt "0" — z. B. nach `draftFromInvoice`/`roundTrip` bei
  // einer bereits gespeicherten Zeile ohne Rabatt. Ein Vergleich mit dem literalen
  // String "0" haette das faelschlich als "Betrag gesetzt" gelesen.
  it("formatierte Nullen ('0,00'/'0,0') -> percent", () => {
    expect(initialDiscountMode({ discountPercent: "0,0", discountAmount: "0,00" })).toBe("percent");
  });
  it("nur ein Betragsrabatt gesetzt -> amount", () => {
    expect(initialDiscountMode({ discountPercent: "0", discountAmount: "50,00" })).toBe("amount");
  });
  it("formatierter Betragsrabatt bei formatiertem Null-Prozent -> amount", () => {
    // Der urspruengliche Bug: discountPercent war "0,0" (nicht literal "0"), was den
    // rohen String-Vergleich in die falsche Richtung kippen liess.
    expect(initialDiscountMode({ discountPercent: "0,0", discountAmount: "50,00" })).toBe("amount");
  });
  it("Prozentrabatt gesetzt (mit oder ohne Betrag) -> percent", () => {
    expect(initialDiscountMode({ discountPercent: "10", discountAmount: "0" })).toBe("percent");
    expect(initialDiscountMode({ discountPercent: "10", discountAmount: "50,00" })).toBe("percent");
  });
  it("ungueltige Eingabe wird wie 0 behandelt -> percent", () => {
    expect(initialDiscountMode({ discountPercent: "abc", discountAmount: "abc" })).toBe("percent");
  });
});
