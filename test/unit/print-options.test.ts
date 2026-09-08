/** Phase 12a, Task 3 — giroSizeMm als vollwertige Druckoption (Zod, Merge, Einfrieren). */
import { describe, it, expect } from "vitest";
import { printSettingsInputSchema, printOptionsOverrideSchema, brandingSettingsInputSchema } from "@/schemas/settings";
import { DEFAULT_PRINT_SETTINGS, effectivePrintOptions, freezePrintOptionsJson } from "@/domain/settings/print";

describe("giroSizeMm (Phase 12a)", () => {
  it("Default 22, Spanne 15..40, nur ganzzahlig", () => {
    expect(printSettingsInputSchema.parse({}).giroSizeMm).toBe(22);
    expect(DEFAULT_PRINT_SETTINGS.giroSizeMm).toBe(22);
    expect(printSettingsInputSchema.parse({ giroSizeMm: 15 }).giroSizeMm).toBe(15);
    expect(printSettingsInputSchema.parse({ giroSizeMm: 40 }).giroSizeMm).toBe(40);
    for (const bad of [14, 41, 22.5]) expect(printSettingsInputSchema.safeParse({ giroSizeMm: bad }).success).toBe(false);
  });
  it("ist ein optionaler Beleg-Override und schlaegt die Organisation", () => {
    expect(printOptionsOverrideSchema.parse({}).giroSizeMm).toBeUndefined();
    const global = { ...DEFAULT_PRINT_SETTINGS, giroSizeMm: 25 };
    expect(effectivePrintOptions(global, null).giroSizeMm).toBe(25);
    expect(effectivePrintOptions(global, JSON.stringify({ giroSizeMm: 35 })).giroSizeMm).toBe(35);
  });
  it("wird beim Festschreiben eingefroren", () => {
    const frozen = JSON.parse(freezePrintOptionsJson({ ...DEFAULT_PRINT_SETTINGS, giroSizeMm: 33 }, null, "standard")) as { giroSizeMm: number };
    expect(frozen.giroSizeMm).toBe(33);
  });
  it("logoWidthMm erlaubt jetzt bis 140 mm, Default bleibt 40", () => {
    expect(brandingSettingsInputSchema.parse({}).logoWidthMm).toBe(40);
    expect(brandingSettingsInputSchema.parse({ logoWidthMm: 140 }).logoWidthMm).toBe(140);
    for (const bad of [9, 141]) expect(brandingSettingsInputSchema.safeParse({ logoWidthMm: bad }).success).toBe(false);
  });

  // GoBD (Lastenheft 51): ein festgeschriebener Beleg friert seine Druckoptionen inkl.
  // giroSizeMm ein — eine spaetere Aenderung der GLOBALEN Organisationseinstellung darf
  // den bereits gefrorenen Beleg nicht mehr beeinflussen (Plan-Ruling Task 3).
  it("ein festgeschriebener Beleg behaelt seine giroSizeMm, auch wenn sich der Organisationsstandard spaeter aendert (GoBD)", () => {
    const globalAtFreeze = { ...DEFAULT_PRINT_SETTINGS, giroSizeMm: 22 };
    const frozenJson = freezePrintOptionsJson(globalAtFreeze, null, "standard");

    // Betreiber aendert danach den globalen GiroCode-Wert der Organisation.
    const globalAfterChange = { ...DEFAULT_PRINT_SETTINGS, giroSizeMm: 40 };

    expect(effectivePrintOptions(globalAfterChange, frozenJson).giroSizeMm).toBe(22);
  });
});
