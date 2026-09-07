/**
 * Phase 6, Task 4 — MCP-Tools: create_dunning (force), send_dunning, set_dunning_state,
 * list_overdue_invoices, run_scheduler_job. Muster: test/integration/mcp-server.test.ts
 * (server["_registeredTools"], getActiveOrg gemockt). Eigenes Jahr 2053 (Testjahr-Konvention).
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
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createDunning } from "@/domain/dunning/create";
import { server } from "@/mcp/server";
import type { CreateInvoiceInput } from "@/schemas";

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

const FIX_DATE = new Date("2053-09-01T10:00:00.000Z");

let orgId: string;
let n = 0;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Mahnwesen GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
});

async function makeCustomer() {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId, name: `MCP-Kunde ${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  return c.id;
}

// list_overdue_invoices nutzt intern das ECHTE "jetzt" (kein now-Override) — Faelligkeit
// daher relativ zur echten Systemzeit, FIX_DATE dient nur der Nummernkreis-Isolierung
// beim Festschreiben (createDunning-Direktaufrufe in diesem File uebergeben now explizit).
async function makeOverdueInvoice(daysOverdue: number) {
  const customerId = await makeCustomer();
  const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000);
  const input: CreateInvoiceInput = {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: dueDate,
    dueDate,
    lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 40000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
  } as CreateInvoiceInput;
  const draft = await createDraftInvoice(orgId, input);
  return finalizeInvoice(draft.id, { now: FIX_DATE });
}

describe("MCP: create_dunning", () => {
  it("erstellt mit force=true eine Mahnung, auch wenn noch nicht faellig", async () => {
    const fin = await makeOverdueInvoice(0);
    const res = await callTool("create_dunning", { invoice: fin.number, force: true });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/erstellt/);
  });

  it("Fehlerpfad: DunningError ohne force bei noch nicht faelliger Stufe", async () => {
    const fin = await makeOverdueInvoice(0);
    const res = await callTool("create_dunning", { invoice: fin.number });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/fällig/);
  });

  it("Fehlerpfad: unbekannte Rechnung", async () => {
    const res = await callTool("create_dunning", { invoice: "unbekannt-123" });
    expect(res.isError).toBe(true);
  });
});

describe("MCP: send_dunning", () => {
  it("Fehlerpfad: keine Mail-Einstellungen hinterlegt", async () => {
    const fin = await makeOverdueInvoice(20);
    const created = await createDunning(fin.id, { now: FIX_DATE, force: true });
    const res = await callTool("send_dunning", { dunning: created.dunning.number });
    expect(res.isError).toBe(true);
  });

  it("Fehlerpfad: unbekannte Mahnung", async () => {
    const res = await callTool("send_dunning", { dunning: "unbekannt-456" });
    expect(res.isError).toBe(true);
  });
});

describe("MCP: set_dunning_state", () => {
  it("setzt PAUSED mit pausedUntil", async () => {
    const fin = await makeOverdueInvoice(10);
    const res = await callTool("set_dunning_state", { invoice: fin.number, state: "PAUSED", pausedUntil: "2053-12-31" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/PAUSED/);
  });

  it("setzt STOPPED", async () => {
    const fin = await makeOverdueInvoice(10);
    const res = await callTool("set_dunning_state", { invoice: fin.number, state: "STOPPED" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/STOPPED/);
  });

  it("Fehlerpfad: unbekannte Rechnung", async () => {
    const res = await callTool("set_dunning_state", { invoice: "unbekannt-789", state: "ACTIVE" });
    expect(res.isError).toBe(true);
  });
});

describe("MCP: list_overdue_invoices", () => {
  it("listet ueberfaellige Rechnungen als JSON", async () => {
    await makeOverdueInvoice(15);
    const res = await callTool("list_overdue_invoices", {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(text(res));
    expect(parsed.widgets.overdueCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it("filtert nach state", async () => {
    const res = await callTool("list_overdue_invoices", { state: "STOPPED" });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(text(res));
    expect(parsed.rows.every((r: { dunningState: string }) => r.dunningState === "STOPPED")).toBe(true);
  });
});

describe("MCP: run_scheduler_job", () => {
  it("stoesst den dunning-Job manuell an", async () => {
    const res = await callTool("run_scheduler_job", { job: "dunning" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/dunning: OK/);
  });
});
