// ── Teil-Update-Eingabeform ohne Zod-Defaults ───────────────────────────────────
// Fix-Welle (Abschluss-Review Phase 11b, Block 5b "Important"): war bisher lokal in
// settings.ts definiert; `dunning.ts#update_dunning_stage` nutzte stattdessen
// `dunningStageFieldsSchema.partial().shape` direkt und reproduzierte damit denselben
// Fehler, den `partialInputShape` fuer die vier Settings-Tools bereits behebt (siehe
// unten) — ein Teil-Update setzte `autoSend`/`enabled` (beide mit `.default(...)`)
// stillschweigend auf ihren Default zurueck, sobald der Aufrufer sie NICHT mitschickte.
// Jetzt eine gemeinsame, exportierte Funktion fuer alle MCP-Tools mit Teil-Update-Semantik
// auf einem Schema mit Defaults.
import { z } from "zod";

/**
 * Fix (Task 8, vorbestehender Fehler): `<schema>.partial().shape` reicht als MCP-
 * `inputSchema` NICHT — die MCP-SDK validiert eingehende Tool-Argumente ueber genau
 * dieses Schema (server/mcp.js#validateToolInput), BEVOR der Handler sie sieht. Traegt
 * ein Feld `.default(...)`, macht `.partial()` es zwar `optional`, das darunterliegende
 * `ZodDefault` greift beim Parsen aber weiterhin fuer einen FEHLENDEN Schluessel (siehe
 * `printOptionsOverrideSchema`-Kommentar in `src/schemas/settings.ts`). Ein Aufruf mit
 * nur EINEM geaenderten Feld liefert an den Handler deshalb trotzdem ALLE defaulteten
 * Felder (mit ihrem Default) — `{ ...current, ...args }` bzw. ein `??`-Merge wie in
 * `dunning.ts#update_dunning_stage` setzt dadurch jedes nicht genannte Feld
 * stillschweigend auf seinen Default zurueck, statt es unveraendert zu lassen.
 *
 * `partialInputShape` baut stattdessen eine Form OHNE Defaults: jedes Feld verliert
 * seinen `.default(...)`-Wrapper (`ZodDefault#removeDefault()`, Zod 4) und wird
 * `.optional()`. Ein fehlender Schluessel bleibt dadurch im geparsten Ergebnis schlicht
 * abwesend — der Handler sieht nur, was der Aufrufer tatsaechlich mitgeschickt hat.
 *
 * Unwrappt NUR ein direkt am Feld liegendes `ZodDefault` (top-level) — ein `.default()`
 * innerhalb eines verschachtelten Objekts oder hinter einem weiteren Wrapper (z. B.
 * `z.string().default("x").nullable()`) bleibt unberuehrt. Keines der vier Settings-
 * Schemas oder `dunningStageFieldsSchema` tut das heute (siehe
 * `test/integration/mcp-settings.test.ts`, das das ueber alle vier Settings-Shapes
 * verifiziert); ein neues Feld dieser Form wuerde stillschweigend denselben Fehler
 * reproduzieren.
 *
 * Generisch (statt `z.ZodRawShape -> z.ZodRawShape`): `dunning.ts#update_dunning_stage`
 * liest einzelne Felder aus dem Handler-`args` (z. B. `args.autoSend ?? existing.autoSend`),
 * was eine je Schluessel erhaltene Feld-Typisierung braucht (nicht nur "irgendein Zod-
 * Schema"); die vier Settings-Tools (settings.ts) spreaden `args` nur
 * (`{ ...current, ...args }`) und kaemen auch mit der schwaecheren Signatur aus.
 */
type UnwrapDefault<Field extends z.ZodTypeAny> = Field extends z.ZodDefault<infer Inner> ? Inner : Field;

// `{ shape: Shape }` statt `z.ZodObject<Shape>` als Parametertyp: zod v4 spaltet den
// "core"-Schema-Typ (den `ZodObject`s eigene Generic-Bound `Shape extends
// core.$ZodShape` verwendet) vom "classic"-Typ `z.ZodTypeAny` — ein `Shape extends
// z.ZodRawShape` (= `core.$ZodShape`) erfuellt NICHT automatisch `z.ZodTypeAny` je
// Feld, wodurch `UnwrapDefault<Shape[K]>` nicht compilierte. Der duck-typed
// `{ shape: ... }`-Parameter laesst TS `Shape` stattdessen aus dem tatsaechlichen
// (konkreten, "classic") Typ jedes Aufrufer-Schemas ableiten.
export function partialInputShape<Shape extends Record<string, z.ZodTypeAny>>(
  schema: { shape: Shape },
): { [K in keyof Shape]: z.ZodOptional<UnwrapDefault<Shape[K]>> } {
  const shape = schema.shape as unknown as Record<string, z.ZodTypeAny>;
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(shape)) {
    const withoutDefault: z.ZodTypeAny = field instanceof z.ZodDefault ? (field as z.ZodDefault<z.ZodTypeAny>).removeDefault() : field;
    out[key] = withoutDefault.optional();
  }
  return out as { [K in keyof Shape]: z.ZodOptional<UnwrapDefault<Shape[K]>> };
}
