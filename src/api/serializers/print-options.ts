/**
 * Antwort-Schemas fuer die Beleg-individuellen Druckoptionen (Phase 7, §36; Layout-
 * Override Phase 11b) unter `/api/v1/{Invoice,Quote,DeliveryNote}/{id}/print-options`.
 *
 * Fix-Welle (Abschluss-Review Phase 11b, Block 5, "Known gap (a)"): dieselben Werte, die
 * bisher nur ueber MCP (`set_print_options`) und die UI-Routen (`PUT
 * /api/{invoices,documents,delivery-notes}/[id]/print-options`) erreichbar waren — dieselbe
 * Domain-Funktion (`setPrintOptions`), dieselbe Zod-Validierung
 * (`printOptionsOverrideSchema`), kein Bypass-Pfad (§55).
 */
import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { printSettingsInputSchema, layoutIdSchema } from "@/schemas";

/** Entspricht `EffectivePrintOptions` (src/lib/pdf/theme.ts) — die globalen Druckoptionen
 *  verschmolzen mit der Beleg-individuellen Ueberschreibung (GET-Antwort). */
export const effectivePrintOptionsSchema = printSettingsInputSchema.extend({ layoutId: layoutIdSchema.optional() });
