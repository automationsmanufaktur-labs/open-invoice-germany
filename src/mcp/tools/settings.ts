// ── Einstellungen (Beleg-Defaults, Druck, Briefpapier, Nummernkreise, Mahnwesen) ─
// Task 1 (Phase 9): reiner Move aus server.ts — Verhalten unveraendert.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { loadDocumentSettings, saveDocumentSettings } from "@/domain/document/settings";
import { loadPrintSettings, savePrintSettings, setPrintOptions } from "@/domain/settings/print";
import { loadBrandingSettings, saveBrandingSettings } from "@/domain/settings/branding";
import { listNumberRanges, updateNumberRange } from "@/domain/numbering/ranges";
import { loadDunningSettings, saveDunningSettings } from "@/domain/dunning/settings";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import {
  documentSettingsInputSchema,
  printSettingsInputSchema,
  printOptionsOverrideSchema,
  brandingSettingsInputSchema,
  NumberRangeDocType,
  dunningSettingsInputSchema,
} from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

export function registerSettingsTools(server: McpServer, ctx: McpToolsContext): void {
  // ── get_settings ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_settings",
    {
      title: "Einstellungen abrufen",
      description:
        "Liest die Einstellungen eines Bereichs: documents (Beleg-Defaults, §33), print (globale Druckoptionen, §36), branding (Briefpapier, §35 — ohne Dateiinhalte), numberRanges (Nummernkreise, §34, optional 'year'), dunning (Mahnwesen-Einstellungen, §26).",
      inputSchema: {
        area: z.enum(["documents", "print", "branding", "numberRanges", "dunning"]),
        year: z.number().int().optional().describe("Nur fuer area=numberRanges — Geschaeftsjahr (Default: laufendes Jahr)"),
      },
    },
    async ({ area, year }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        switch (area) {
          case "documents":
            return ctx.ok(JSON.stringify(await loadDocumentSettings(org.id), null, 2));
          case "print":
            return ctx.ok(JSON.stringify(await loadPrintSettings(org.id), null, 2));
          case "branding":
            return ctx.ok(JSON.stringify(await loadBrandingSettings(org.id), null, 2));
          case "numberRanges":
            return ctx.ok(JSON.stringify(await listNumberRanges(org.id, year ?? new Date().getFullYear()), null, 2));
          case "dunning":
            return ctx.ok(JSON.stringify(await loadDunningSettings(org.id), null, 2));
        }
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_document_settings ───────────────────────────────────────────────────
  server.registerTool(
    "update_document_settings",
    {
      title: "Beleg-Einstellungen aktualisieren",
      description:
        "Aktualisiert die org-weiten Beleg-Einstellungen (§33: Angebote/Rechnungen/Lieferscheine/wiederkehrende Rechnungen). Nicht angegebene Felder bleiben unveraendert (Merge mit dem aktuellen Stand).",
      inputSchema: documentSettingsInputSchema.partial().shape,
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const current = await loadDocumentSettings(org.id);
        const saved = await saveDocumentSettings(org.id, { ...current, ...args });
        return ctx.ok(`Beleg-Einstellungen gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_print_settings ──────────────────────────────────────────────────────
  server.registerTool(
    "update_print_settings",
    {
      title: "Globale Druckoptionen aktualisieren",
      description: "Aktualisiert die zehn globalen Druckoptionen-Schalter (§36). Nicht angegebene Felder bleiben unveraendert (Merge mit dem aktuellen Stand).",
      inputSchema: printSettingsInputSchema.partial().shape,
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const current = await loadPrintSettings(org.id);
        const saved = await savePrintSettings(org.id, { ...current, ...args });
        return ctx.ok(`Druckoptionen gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_branding_settings ───────────────────────────────────────────────────
  server.registerTool(
    "update_branding_settings",
    {
      title: "Briefpapier-Einstellungen aktualisieren",
      description:
        "Aktualisiert Farbe/Raender/Schriftgroesse/Fusszeilen/Absenderzeile des Briefpapiers (§35). OHNE Dateien — Logo-/Hintergrund-Upload nur ueber die UI-Route (Magic-Byte-Pruefung). Nicht angegebene Felder bleiben unveraendert.",
      inputSchema: brandingSettingsInputSchema.omit({ logoPath: true, backgroundPath: true }).partial().shape,
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const current = await loadBrandingSettings(org.id);
        // Verteidigung in der Tiefe: logoPath/backgroundPath NIE aus `args` uebernehmen,
        // selbst wenn ein Aufrufer sie mitschickt — die inputSchema-Validierung des
        // McpServer-Dispatchers wuerde sie zwar bereits herausfiltern (Zod-Objekt ohne
        // .passthrough), aber ein direkter Handler-Aufruf (z. B. in Tests) umgeht diese
        // Schicht. Datei-Uploads laufen ausschliesslich ueber die UI-Route.
        const { logoPath: _ignoredLogoPath, backgroundPath: _ignoredBackgroundPath, ...safeArgs } = args as Record<string, unknown>;
        void _ignoredLogoPath;
        void _ignoredBackgroundPath;
        const saved = await saveBrandingSettings(org.id, { ...current, ...safeArgs, logoPath: current.logoPath, backgroundPath: current.backgroundPath });
        return ctx.ok(`Briefpapier-Einstellungen gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_number_range ────────────────────────────────────────────────────────
  server.registerTool(
    "update_number_range",
    {
      title: "Nummernkreis aktualisieren",
      description:
        "Aktualisiert Muster/Praefix/Polsterung/jaehrlichen Reset/naechste Nummer eines Nummernkreises (§34, u.a. CUSTOMER/PRODUCT/INVOICE/ANGEBOT/...). Nummern koennen nie zurueckgedreht werden (GoBD). Nicht angegebene Felder bleiben unveraendert (Merge mit dem aktuellen Stand des laufenden Jahres).",
      inputSchema: {
        docType: NumberRangeDocType,
        pattern: z.string().optional(),
        prefix: z.string().optional(),
        seqPadding: z.number().int().min(1).max(8).optional(),
        yearlyReset: z.boolean().optional(),
        nextValue: z.number().int().min(1).optional(),
      },
    },
    async ({ docType, ...args }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const year = new Date().getFullYear();
        const ranges = await listNumberRanges(org.id, year);
        const current = ranges.find((r) => r.docType === docType);
        if (!current) return ctx.fail(`Unbekannter Nummernkreis-Typ "${docType}".`);
        const merged = {
          pattern: args.pattern ?? current.pattern,
          prefix: args.prefix ?? current.prefix,
          seqPadding: args.seqPadding ?? current.seqPadding,
          yearlyReset: args.yearlyReset ?? current.yearlyReset,
          nextValue: args.nextValue ?? current.currentValue + 1,
        };
        const saved = await updateNumberRange(org.id, docType, merged, "mcp");
        return ctx.ok(`Nummernkreis "${docType}" gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── set_print_options ────────────────────────────────────────────────────────
  // S9 (Fix-Welle, Final-Review): MCP-Pendant zu PUT /api/{invoices,documents,
  // delivery-notes}/[id]/print-options — dieselbe Domain-Funktion (setPrintOptions),
  // dieselbe Zod-Validierung (printOptionsOverrideSchema), kein Bypass-Pfad (§55).
  server.registerTool(
    "set_print_options",
    {
      title: "Beleg-individuelle Druckoptionen setzen",
      description:
        "Setzt die Beleg-individuelle Ueberschreibung der globalen Druckoptionen (§36) fuer eine Rechnung/Gutschrift (kind=INVOICE), ein Angebot/eine Auftragsbestaetigung (kind=QUOTE) oder einen Lieferschein (kind=DELIVERY_NOTE). Nur erlaubt, solange der Beleg im Entwurf (DRAFT) ist. Nur die uebergebenen Felder werden gesetzt (Ersatz der bisherigen Ueberschreibung, kein Merge).",
      inputSchema: {
        kind: z.enum(["INVOICE", "QUOTE", "DELIVERY_NOTE"]),
        id: z.string().min(1),
        options: printOptionsOverrideSchema,
      },
    },
    async ({ kind, id, options }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const saved = await setPrintOptions(org.id, { kind, id }, options);
        return ctx.ok(`Druckoptionen fuer ${kind} "${id}" gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_dunning_settings ────────────────────────────────────────────────────
  server.registerTool(
    "update_dunning_settings",
    {
      title: "Mahnwesen-Einstellungen aktualisieren",
      description:
        "Aktualisiert die org-weiten Mahnwesen-Einstellungen (§26, Nachtrag Phase 7/§55: autoCreate, autoSend, Basiszinssatz, Karenztage). Nicht angegebene Felder bleiben unveraendert.",
      inputSchema: dunningSettingsInputSchema.partial().shape,
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const current = await loadDunningSettings(org.id);
        const saved = await saveDunningSettings(org.id, { ...current, ...args });
        return ctx.ok(`Mahnwesen-Einstellungen gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
