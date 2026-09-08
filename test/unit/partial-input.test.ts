/**
 * Fix-Welle (Abschluss-Review Phase 11b, Block 1 "Minor"): `partialInputShape` unwrappt
 * nur ein TOP-LEVEL `ZodDefault` je Feld (siehe Kommentar in src/mcp/tools/partial-input.ts)
 * — ein `.default(...)` innerhalb eines verschachtelten Objekts oder hinter einem weiteren
 * Wrapper wuerde stillschweigend denselben "Teil-Update setzt auf Default zurueck"-Fehler
 * reproduzieren, den `partialInputShape` fuer die MCP-Tools eigentlich beheben soll. Dieser
 * Test ist die Wachfunktion: er iteriert die Shapes aller vier Settings-Schemas UND
 * `dunningStageFieldsSchema` (Teil-Update-Schema von `update_dunning_stage`) und prueft,
 * dass NACH `partialInputShape` kein `ZodDefault` mehr uebrig bleibt — sollte ein
 * zukuenftiges Feld die einfache "top-level `.default(...)`"-Form verlassen, schlaegt
 * dieser Test fehl, statt den Fehler still in Produktion durchzureichen.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  documentSettingsInputSchema,
  printSettingsInputSchema,
  brandingSettingsInputSchema,
  dunningSettingsInputSchema,
  dunningStageFieldsSchema,
} from "@/schemas";
import { partialInputShape } from "@/mcp/tools/partial-input";

/**
 * Je EIN Aufruf je Schema (statt einer gemeinsamen Sammlung durchiteriert) — eine
 * gemeinsame `Record<string, z.ZodObject<...>>`-Sammlung wuerde jedes konkrete Schema auf
 * einen Supertyp verallgemeinern (bzw. bei Vereinigung der Elementtypen nur das ERSTE
 * Element korrekt inferieren) und dieselbe "core"-/"classic"-Typinkompatibilitaet ausloesen,
 * die `partial-input.ts`s Kommentar fuer `z.ZodRawShape` beschreibt. Direkte, einzelne
 * Aufrufe (wie in settings.ts/dunning.ts) lassen TS `Shape` je Schema korrekt inferieren.
 */
function checkPartialInputShape<Shape extends Record<string, z.ZodTypeAny>>(schemaName: string, schema: { shape: Shape }): void {
  describe(schemaName, () => {
    it("mindestens ein Feld traegt tatsaechlich .default(...) (sonst waere dieser Test wirkungslos)", () => {
      const hasDefault = Object.values(schema.shape).some((f) => f instanceof z.ZodDefault);
      expect(hasDefault).toBe(true);
    });

    it("partialInputShape entfernt jedes (top-level) ZodDefault und macht jedes Feld optional", () => {
      const shape = partialInputShape(schema);
      for (const [key, field] of Object.entries(shape)) {
        const typed = field as z.ZodTypeAny;
        expect(typed instanceof z.ZodDefault, `${schemaName}.${key} ist nach partialInputShape noch ein ZodDefault`).toBe(false);
        expect(typed instanceof z.ZodOptional, `${schemaName}.${key} ist nach partialInputShape kein ZodOptional`).toBe(true);
      }
    });

    it("ein leeres Objekt parst erfolgreich zu einem leeren Ergebnis (kein Default fuellt still auf)", () => {
      const shape = partialInputShape(schema);
      const parsed = z.object(shape).parse({});
      expect(Object.keys(parsed)).toEqual([]);
    });
  });
}

checkPartialInputShape("documentSettingsInputSchema", documentSettingsInputSchema);
checkPartialInputShape("printSettingsInputSchema", printSettingsInputSchema);
// Die vier Settings-Tools nutzen `brandingSettingsInputSchema.omit({ logoPath: true,
// backgroundPath: true, faviconPath: true, appLogoPath: true })` als MCP-inputSchema
// (settings.ts) — dasselbe Objekt, nur ohne die vier Datei-Felder, die keine
// `.default(...)`-Felder sind; fuer diesen Test irrelevant.
checkPartialInputShape("brandingSettingsInputSchema", brandingSettingsInputSchema);
checkPartialInputShape("dunningSettingsInputSchema", dunningSettingsInputSchema);
// Kein "Settings"-Schema im engeren Sinn, aber dieselbe Teil-Update-Semantik
// (update_dunning_stage, dunning.ts) — siehe partial-input.ts-Kommentar.
checkPartialInputShape("dunningStageFieldsSchema", dunningStageFieldsSchema);
