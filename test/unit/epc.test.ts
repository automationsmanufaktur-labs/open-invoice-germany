/**
 * Phase 7, Task 3 (§37) — EPC-QR-Code-Payload ("GiroCode"), reine Funktion.
 * Testjahr 2056 (siehe plan-header.md).
 */
import { describe, it, expect } from "vitest";
import { buildEpcPayload, EpcError } from "@/lib/pdf/epc";

describe("buildEpcPayload — exaktes Format (EPC069-12)", () => {
  it("baut die Payload byte-für-byte wie im Brief-Beispiel", () => {
    const payload = buildEpcPayload({
      name: "Muster GmbH",
      iban: "DE02120300000000202051",
      bic: null,
      amountCents: 11900,
      remittance: "RE-2056-00001",
    });
    expect(payload).toBe(
      "BCD\n002\n1\nSCT\n\nMuster GmbH\nDE02120300000000202051\nEUR119.00\n\n\nRE-2056-00001",
    );
  });

  it("trägt den BIC in Zeile 5, wenn vorhanden", () => {
    const payload = buildEpcPayload({
      name: "Muster GmbH",
      iban: "DE02120300000000202051",
      bic: "INGDDEFFXXX",
      amountCents: 100,
      remittance: "RE-2056-00002",
    });
    const lines = payload.split("\n");
    expect(lines[4]).toBe("INGDDEFFXXX");
  });

  it("normalisiert IBAN-Leerzeichen und Kleinschreibung", () => {
    const payload = buildEpcPayload({
      name: "Muster GmbH",
      iban: "de02 1203 0000 0000 2020 51",
      bic: null,
      amountCents: 100,
      remittance: "x",
    });
    expect(payload).toContain("DE02120300000000202051");
  });

  it("formatiert den Betrag als EUR<Cent/100 mit 2 Nachkommastellen>", () => {
    const payload = buildEpcPayload({ name: "A", iban: "DE02120300000000202051", bic: null, amountCents: 100000, remittance: "x" });
    expect(payload).toContain("EUR1000.00");
  });

  it("keine Trailing-Newline, genau 11 Zeilen", () => {
    const payload = buildEpcPayload({ name: "A", iban: "DE02120300000000202051", bic: null, amountCents: 100, remittance: "x" });
    expect(payload.endsWith("\n")).toBe(false);
    expect(payload.split("\n")).toHaveLength(11);
  });
});

describe("buildEpcPayload — Validierung (EpcError)", () => {
  it("lehnt einen Namen > 70 Zeichen ab", () => {
    expect(() =>
      buildEpcPayload({ name: "X".repeat(71), iban: "DE02120300000000202051", bic: null, amountCents: 100, remittance: "x" }),
    ).toThrow(EpcError);
  });

  it("akzeptiert genau 70 Zeichen", () => {
    expect(() =>
      buildEpcPayload({ name: "X".repeat(70), iban: "DE02120300000000202051", bic: null, amountCents: 100, remittance: "x" }),
    ).not.toThrow();
  });

  it("lehnt einen leeren Namen ab", () => {
    expect(() => buildEpcPayload({ name: "  ", iban: "DE02120300000000202051", bic: null, amountCents: 100, remittance: "x" })).toThrow(EpcError);
  });

  it("lehnt einen Betrag < 1 Cent ab", () => {
    expect(() => buildEpcPayload({ name: "A", iban: "DE02120300000000202051", bic: null, amountCents: 0, remittance: "x" })).toThrow(EpcError);
  });

  it("lehnt einen Betrag > 99.999.999.999 Cent ab", () => {
    expect(() =>
      buildEpcPayload({ name: "A", iban: "DE02120300000000202051", bic: null, amountCents: 99_999_999_999 + 1, remittance: "x" }),
    ).toThrow(EpcError);
  });

  it("akzeptiert den Betrag genau an der oberen Grenze", () => {
    expect(() =>
      buildEpcPayload({ name: "A", iban: "DE02120300000000202051", bic: null, amountCents: 99_999_999_999, remittance: "x" }),
    ).not.toThrow();
  });

  it("lehnt eine Payload > 331 Byte ab (sehr langer Verwendungszweck)", () => {
    expect(() =>
      buildEpcPayload({
        name: "Muster GmbH",
        iban: "DE02120300000000202051",
        bic: null,
        amountCents: 100,
        remittance: "X".repeat(300),
      }),
    ).toThrow(EpcError);
  });
});
