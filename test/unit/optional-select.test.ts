import { describe, it, expect } from "vitest";
import { optionalSelectValue, emptyOptionLabel } from "@/lib/forms/optional-select";

describe("optionalSelectValue (Fix-Welle B3)", () => {
  it("Anlage (isEdit=false), Feld leer -> undefined (Key weggelassen, Kundenvorgabe greift)", () => {
    expect(optionalSelectValue("", false)).toBeUndefined();
  });
  it("Bearbeiten (isEdit=true), Feld leer -> explizites null (Referenz wird geleert)", () => {
    expect(optionalSelectValue("", true)).toBeNull();
  });
  it("Feld gesetzt -> Wert unabhaengig von isEdit", () => {
    expect(optionalSelectValue("addr-1", false)).toBe("addr-1");
    expect(optionalSelectValue("addr-1", true)).toBe("addr-1");
  });
});

describe("emptyOptionLabel (Fix-Welle B3)", () => {
  it("mit Default -> nennt die Kundenvorgabe explizit", () => {
    expect(emptyOptionLabel(true)).toBe("— Standard des Kunden —");
  });
  it("ohne Default -> neutrale Beschriftung, taeuscht keinen Default vor", () => {
    expect(emptyOptionLabel(false)).toBe("— keine —");
  });
});
