import { describe, it, expect } from "vitest";
import { buildFooterColumns } from "@/lib/pdf/footer";
import { brandingSettingsInputSchema } from "@/schemas/settings";

const seller = { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin", vatId: "DE123456789", taxNumber: "12/345/67890", email: "info@muster.example", phone: "030 1" };

describe("buildFooterColumns", () => {
  it("AUTO: vier Spalten aus Stammdaten, leere Zeilen entfallen", () => {
    const cols = buildFooterColumns({ seller, iban: "DE02120300000000202051", bic: "BYLADEM1001", bankName: "Testbank", website: "muster.example", ownerName: "Erika Muster" }, brandingSettingsInputSchema.parse({}));
    expect(cols).toHaveLength(4);
    expect(cols[0]!.lines).toEqual(["Muster GmbH", "Hauptstr. 1", "12345 Berlin"]);
    expect(cols[1]!.lines).toEqual(["Tel. 030 1", "E-Mail info@muster.example", "Web muster.example"]);
    expect(cols[2]!.lines).toEqual(["USt-IdNr. DE123456789", "Steuer-Nr. 12/345/67890", "Inhaber/-in Erika Muster"]);
    expect(cols[3]!.lines).toEqual(["Bank Testbank", "IBAN DE02 1203 0000 0000 2020 51", "BIC BYLADEM1001"]);
  });
  it("AUTO ohne Bank/Kontakt: nur die belegten Spalten", () => {
    const cols = buildFooterColumns({ seller: { ...seller, email: null, phone: null, vatId: null, taxNumber: null } }, brandingSettingsInputSchema.parse({}));
    expect(cols).toHaveLength(1);
  });
  it("CUSTOM: drei Freitextspalten; leer ⇒ AUTO", () => {
    const custom = brandingSettingsInputSchema.parse({ footerMode: "CUSTOM", footerLeft: "L", footerRight: "R" });
    expect(buildFooterColumns({ seller }, custom).map((c) => c.lines)).toEqual([["L"], ["R"]]);
    const empty = brandingSettingsInputSchema.parse({ footerMode: "CUSTOM" });
    expect(buildFooterColumns({ seller }, empty)[0]!.lines[0]).toBe("Muster GmbH");
  });
  it("Fix-Runde 1 (Koordinator-Ruling): AUTO bleibt AUTO, auch wenn footerLeft/-Center/-Right noch (Alt-)Text tragen — footerMode ist die alleinige Weiche, nicht die Praesenz der Freitextfelder", () => {
    const autoWithLegacyText = brandingSettingsInputSchema.parse({ footerMode: "AUTO", footerLeft: "Alter Freitext aus Phase 7" });
    const cols = buildFooterColumns({ seller }, autoWithLegacyText);
    expect(cols[0]!.lines).toEqual(["Muster GmbH", "Hauptstr. 1", "12345 Berlin"]);
    expect(cols.map((c) => c.lines).flat()).not.toContain("Alter Freitext aus Phase 7");
  });
});
