/**
 * Phase 7, Task 4 — MCP-Tools: get_settings, update_document_settings,
 * update_print_settings, update_branding_settings, update_number_range,
 * update_dunning_settings, list_dunning_stages, update_dunning_stage (Nachtrag Phase 6,
 * §55). Muster: mcp-dunning.test.ts (server["_registeredTools"], getActiveOrg gemockt).
 * Eigenes Jahr 2058 (Testjahr-Konvention).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { server } from "@/mcp/server";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}
interface ZodLikeSchema {
  safeParseAsync: (data: unknown) => Promise<{ success: true; data: unknown } | { success: false; error: { message: string } }>;
}
interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  /** Vom MCP-SDK aus der `inputSchema`-Konfiguration gebautes Zod-Objekt (server/mcp.js
   *  #getZodSchemaObject) — echte Clients rufen NIE `handler` direkt auf, sondern lassen
   *  zuerst dieses Schema ueber die Argumente laufen (#validateToolInput). Ein direkter
   *  `tool.handler(args)`-Aufruf haette den vorbestehenden Defaults-Fehler (Task 8: Zod
   *  fuellt bei `<schema>.partial().shape` fehlende, aber defaultete Felder trotzdem auf)
   *  NIE reproduziert — `args` haette nur die tatsaechlich uebergebenen Testschluessel
   *  enthalten, nie die vom SDK ergaenzten Defaults der uebrigen Felder. */
  inputSchema?: ZodLikeSchema;
}
/** Ruft ein MCP-Tool wie ein echter Client auf — inkl. Schema-Validierung, siehe RegisteredTool oben. */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`MCP-Tool "${name}" ist nicht registriert.`);
  if (tool.inputSchema) {
    const parsed = await tool.inputSchema.safeParseAsync(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Validierung fehlgeschlagen: ${parsed.error.message}` }], isError: true };
    return tool.handler(parsed.data as Record<string, unknown>);
  }
  return tool.handler(args);
}
function text(result: ToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Einstellungen GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
});

describe("get_settings", () => {
  it("liefert documents", async () => {
    const res = await callTool("get_settings", { area: "documents" });
    const parsed = JSON.parse(text(res));
    expect(parsed.invoiceDueDays).toBe(14);
  });

  it("liefert print", async () => {
    const res = await callTool("get_settings", { area: "print" });
    const parsed = JSON.parse(text(res));
    expect(parsed.showGiroCode).toBe(true);
  });

  it("liefert branding", async () => {
    const res = await callTool("get_settings", { area: "branding" });
    const parsed = JSON.parse(text(res));
    expect(parsed.primaryColor).toBe("#111111");
  });

  it("liefert numberRanges (Array von 9 Typen)", async () => {
    const res = await callTool("get_settings", { area: "numberRanges", year: 2058 });
    const parsed = JSON.parse(text(res));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(9);
  });

  it("liefert dunning", async () => {
    const res = await callTool("get_settings", { area: "dunning" });
    const parsed = JSON.parse(text(res));
    expect(typeof parsed.autoCreate).toBe("boolean");
  });
});

describe("update_document_settings", () => {
  it("aktualisiert nur die angegebenen Felder (Merge)", async () => {
    // Fix-Welle (Abschluss-Review, Block 1 "Minor"): `eInvoiceDefault === true` allein ist
    // KEIN diskriminierender Beleg — das ist zugleich der Zod-Default, der Test waere auch
    // beim vorbestehenden Fehler (siehe update_print_settings-Kommentar oben) gruen
    // geblieben. `storeAcceptIp` (Default `false`) wird deshalb zuerst explizit auf sein
    // GEGENTEIL gesetzt, bevor das eigentliche Teil-Update geprueft wird.
    await callTool("update_document_settings", { storeAcceptIp: true });
    const before = JSON.parse(text(await callTool("get_settings", { area: "documents" })));
    expect(before.storeAcceptIp).toBe(true);

    const res = await callTool("update_document_settings", { invoiceDueDays: 30 });
    expect(res.isError).toBeFalsy();

    const after = JSON.parse(text(await callTool("get_settings", { area: "documents" })));
    expect(after.invoiceDueDays).toBe(30);
    // Nicht angegebenes, bereits vom Default abweichendes Feld bleibt unveraendert.
    expect(after.storeAcceptIp).toBe(true);
  });

  it("liefert einen Fehler bei ungueltiger Eingabe", async () => {
    const res = await callTool("update_document_settings", { invoiceDueDays: -1 });
    expect(res.isError).toBe(true);
  });
});

describe("update_print_settings", () => {
  it("aktualisiert nur die angegebenen Felder (Merge)", async () => {
    await callTool("update_print_settings", { foldMarks: true });
    const after = JSON.parse(text(await callTool("get_settings", { area: "print" })));
    expect(after.foldMarks).toBe(true);
    expect(after.showFooter).toBe(true); // unveraendert
  });

  // Fix (Task 8, vorbestehender Fehler): `<schema>.partial().shape` als MCP-inputSchema
  // liess Zod fehlende, aber defaultete Felder trotzdem auffuellen — ein Teil-Update mit
  // nur EINEM Schalter setzte dadurch jeden nicht genannten Schalter auf seinen Default
  // zurueck. Reproduziert nur ueber die echte SDK-Validierung (callTool routet jetzt
  // durch tool.inputSchema, siehe oben) — ein direkter Handler-Aufruf haette das nie
  // sichtbar gemacht.
  it("Teil-Update mit nur einem Schalter setzt andere Schalter nicht auf Default zurueck", async () => {
    await callTool("update_print_settings", { showGiroCode: false, punchMarks: true });
    const before = JSON.parse(text(await callTool("get_settings", { area: "print" })));
    expect(before.showGiroCode).toBe(false);
    expect(before.punchMarks).toBe(true);

    const res = await callTool("update_print_settings", { showPageNumbers: false });
    expect(res.isError).toBeFalsy();

    const after = JSON.parse(text(await callTool("get_settings", { area: "print" })));
    expect(after.showPageNumbers).toBe(false);
    // Nicht genannte Schalter (bereits von den defaults abweichend) bleiben unveraendert.
    expect(after.showGiroCode).toBe(false);
    expect(after.punchMarks).toBe(true);
  });
});

describe("update_branding_settings", () => {
  it("aktualisiert Farbe/Raender, akzeptiert keine Dateipfade", async () => {
    const res = await callTool("update_branding_settings", { primaryColor: "#00ff00", marginTopMm: 22 });
    expect(res.isError).toBeFalsy();
    const after = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    expect(after.primaryColor).toBe("#00ff00");
    expect(after.marginTopMm).toBe(22);
  });

  it("ignoriert ein mitgegebenes logoPath (kein Datei-Upload ueber MCP moeglich)", async () => {
    const before = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    await callTool("update_branding_settings", { logoPath: "boesartig/pfad.png", fontSizePt: 11 } as unknown as Record<string, unknown>);
    const after = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    expect(after.logoPath).toBe(before.logoPath);
    expect(after.fontSizePt).toBe(11);
  });

  // Fix-Welle (Fix 1): faviconPath/appLogoPath sind dieselbe Regel wie logoPath/
  // backgroundPath — nur die Upload-Route (POST /api/settings/branding/upload) setzt sie.
  it("ignoriert mitgegebene faviconPath/appLogoPath (kein Datei-Upload ueber MCP moeglich)", async () => {
    const before = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    await callTool("update_branding_settings", {
      faviconPath: "boesartig/icon.png",
      appLogoPath: "boesartig/logo.png",
      fontSizePt: 13,
    } as unknown as Record<string, unknown>);
    const after = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    expect(after.faviconPath).toBe(before.faviconPath);
    expect(after.appLogoPath).toBe(before.appLogoPath);
    expect(after.fontSizePt).toBe(13);
  });

  // Fix (Task 8, vorbestehender Fehler): siehe Kommentar bei update_print_settings oben —
  // `brandingSettingsInputSchema.omit(...).partial().shape` hatte dieselbe Schwaeche.
  it("Teil-Update mit nur einem Feld setzt andere Felder nicht auf Default zurueck", async () => {
    await callTool("update_branding_settings", { layoutId: "schlicht", primaryColor: "#123456" });
    const before = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    expect(before.layoutId).toBe("schlicht");
    expect(before.primaryColor).toBe("#123456");

    const res = await callTool("update_branding_settings", { logoWidthMm: 55 });
    expect(res.isError).toBeFalsy();

    const after = JSON.parse(text(await callTool("get_settings", { area: "branding" })));
    expect(after.logoWidthMm).toBe(55);
    // Nicht genannte Felder (bereits von den Defaults abweichend) bleiben unveraendert.
    expect(after.layoutId).toBe("schlicht");
    expect(after.primaryColor).toBe("#123456");
  });
});

describe("list_pdf_layouts (Phase 11b, Task 8)", () => {
  it("list_pdf_layouts und Branding-Layoutfelder ueber MCP", async () => {
    const list = JSON.parse(text(await callTool("list_pdf_layouts", {}))) as { id: string }[];
    expect(list.map((l) => l.id)).toContain("schlicht");

    await callTool("update_branding_settings", { layoutId: "schlicht", layoutByType: { DUNNING: "kompakt" }, footerMode: "CUSTOM" });
    const branding = JSON.parse(text(await callTool("get_settings", { area: "branding" }))) as {
      layoutId: string;
      layoutByType: Record<string, string>;
      footerMode: string;
    };
    expect(branding.layoutId).toBe("schlicht");
    expect(branding.layoutByType).toEqual({ DUNNING: "kompakt" });
    expect(branding.footerMode).toBe("CUSTOM");

    const bad = await callTool("update_branding_settings", { layoutId: "premium" });
    expect(bad.isError).toBe(true);
  });
});

describe("update_number_range", () => {
  it("aktualisiert Praefix/Muster eines Nummernkreises", async () => {
    const res = await callTool("update_number_range", { docType: "PRODUCT", prefix: "ART-X-", pattern: "{PREFIX}{SEQ:5}" });
    expect(res.isError).toBeFalsy();
    const ranges = JSON.parse(text(await callTool("get_settings", { area: "numberRanges", year: 2058 })));
    const product = ranges.find((r: { docType: string }) => r.docType === "PRODUCT");
    expect(product.prefix).toBe("ART-X-");
  });

  it("lehnt Zurueckdrehen ab (409-artiger Fehler)", async () => {
    await callTool("update_number_range", { docType: "DUNNING", nextValue: 20 });
    const res = await callTool("update_number_range", { docType: "DUNNING", nextValue: 1 });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/zurueckgedreht/);
  });

  it("meldet einen unbekannten docType als Fehler", async () => {
    const res = await callTool("update_number_range", { docType: "SONSTWAS" } as unknown as Record<string, unknown>);
    expect(res.isError).toBe(true);
  });
});

describe("update_dunning_settings (Nachtrag §55)", () => {
  it("aktualisiert nur die angegebenen Felder (Merge)", async () => {
    // Fix-Welle (Abschluss-Review, Block 1 "Minor"): dieselbe Luecke wie bei
    // update_document_settings oben — `autoCreate` (Default `true`) wird zuerst auf sein
    // Gegenteil gesetzt, damit das nachfolgende Teil-Update tatsaechlich diskriminiert.
    await callTool("update_dunning_settings", { autoCreate: false });
    const before = JSON.parse(text(await callTool("get_settings", { area: "dunning" })));
    expect(before.autoCreate).toBe(false);

    const res = await callTool("update_dunning_settings", { gracePeriodDays: 5 });
    expect(res.isError).toBeFalsy();
    const after = JSON.parse(text(await callTool("get_settings", { area: "dunning" })));
    expect(after.gracePeriodDays).toBe(5);
    // Nicht angegebenes, bereits vom Default abweichendes Feld bleibt unveraendert.
    expect(after.autoCreate).toBe(false);
  });
});

describe("list_dunning_stages (Nachtrag §55)", () => {
  it("listet die Standardstufen", async () => {
    const res = await callTool("list_dunning_stages");
    const stages = JSON.parse(text(res));
    expect(stages.length).toBeGreaterThanOrEqual(4);
  });
});

describe("update_dunning_stage (Nachtrag §55)", () => {
  it("aktualisiert eine Mahnstufe per Merge (nur angegebene Felder)", async () => {
    const stages = JSON.parse(text(await callTool("list_dunning_stages")));
    const first = stages[0];
    const res = await callTool("update_dunning_stage", { id: first.id, name: "Erste Erinnerung (angepasst)" });
    expect(res.isError).toBeFalsy();
    const after = JSON.parse(text(await callTool("list_dunning_stages")));
    const updated = after.find((s: { id: string }) => s.id === first.id);
    expect(updated.name).toBe("Erste Erinnerung (angepasst)");
    // Unveraenderte Felder bleiben erhalten.
    expect(updated.daysAfterDue).toBe(first.daysAfterDue);
  });

  it("meldet eine unbekannte Mahnstufen-ID als Fehler", async () => {
    const res = await callTool("update_dunning_stage", { id: "unbekannt", name: "x" });
    expect(res.isError).toBe(true);
  });

  // Fix-Welle (Abschluss-Review Phase 11b, Block 5b "Important"): `update_dunning_stage`
  // nutzte bisher `dunningStageFieldsSchema.partial().shape` direkt statt
  // `partialInputShape(...)` (siehe Kommentar bei update_print_settings oben) —
  // `autoSend` (default false) und `enabled` (default true) wurden bei jedem Teil-Update
  // stillschweigend auf ihren Default zurueckgesetzt. Auf der Produktivinstanz mit aktivem
  // Scheduler haette das eine vom Betreiber deaktivierte Stufe (enabled: false)
  // unbeabsichtigt re-aktiviert.
  it("enabled:false und autoSend:true (beide vom Default abweichend) ueberleben ein Update, das nur den Namen aendert", async () => {
    const stages = JSON.parse(text(await callTool("list_dunning_stages"))) as { id: string }[];
    const [stage] = stages;
    if (!stage) throw new Error("keine Mahnstufe gefunden");

    // Setup: beide Felder auf das GEGENTEIL ihres Defaults bringen — nur so ist ein
    // spaeteres stillschweigendes Zuruecksetzen auf den Default ueberhaupt von
    // "unveraendert geblieben" unterscheidbar.
    const setup = await callTool("update_dunning_stage", { id: stage.id, enabled: false, autoSend: true });
    expect(setup.isError).toBeFalsy();
    const afterSetup = JSON.parse(text(await callTool("list_dunning_stages"))).find((s: { id: string }) => s.id === stage.id);
    expect(afterSetup.enabled).toBe(false);
    expect(afterSetup.autoSend).toBe(true);

    // Diskriminierender Aufruf: NUR `name` mitschicken.
    const res = await callTool("update_dunning_stage", { id: stage.id, name: "Umbenannt (Fix-Welle Test)" });
    expect(res.isError).toBeFalsy();

    const after = JSON.parse(text(await callTool("list_dunning_stages"))).find((s: { id: string }) => s.id === stage.id);
    expect(after.name).toBe("Umbenannt (Fix-Welle Test)");
    expect(after.enabled).toBe(false);
    expect(after.autoSend).toBe(true);
  });
});
