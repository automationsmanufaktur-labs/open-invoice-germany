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
interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`MCP-Tool "${name}" ist nicht registriert.`);
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
    const before = JSON.parse(text(await callTool("get_settings", { area: "documents" })));
    expect(before.eInvoiceDefault).toBe(true);

    const res = await callTool("update_document_settings", { invoiceDueDays: 30 });
    expect(res.isError).toBeFalsy();

    const after = JSON.parse(text(await callTool("get_settings", { area: "documents" })));
    expect(after.invoiceDueDays).toBe(30);
    // Nicht angegebene Felder bleiben unveraendert.
    expect(after.eInvoiceDefault).toBe(true);
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
    const res = await callTool("update_dunning_settings", { gracePeriodDays: 5 });
    expect(res.isError).toBeFalsy();
    const after = JSON.parse(text(await callTool("get_settings", { area: "dunning" })));
    expect(after.gracePeriodDays).toBe(5);
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
});
