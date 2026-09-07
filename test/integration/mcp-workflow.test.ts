/**
 * Phase 8b, Task 4 — MCP-Tools: list_invoices, get_dashboard, get_customer_overview,
 * get_timeline, list_notifications, mark_notifications_read, record_payment (+note),
 * update_recurring_invoice. Muster: mcp-customer.test.ts (server["_registeredTools"],
 * getActiveOrg gemockt). Eigenes Jahr 2068 (Testjahr-Konvention, Teil "routes/mcp") —
 * `test/integration/list-routes.test.ts` nutzt dasselbe Jahr fuer Belegdaten, daher
 * eigener NumberRange-Praefix ("MCPW-") um eine globale Invoice.number-Kollision
 * auszuschliessen.
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
import { updateNumberRange } from "@/domain/numbering/ranges";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createRecurring } from "@/domain/recurring/create";
import { createNotification } from "@/domain/notifications/create";
import { server } from "@/mcp/server";
import type { CreateInvoiceInput, CreateRecurringInput } from "@/schemas";

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

const ISSUE = new Date(2068, 5, 1, 10, 0, 0);

let orgId: string;
let customerId: string;
let customerName: string;
let invoiceId: string;
let recurringId: string;

function line(description: string) {
  return {
    description,
    quantityMilli: 1000,
    unit: "HUR" as const,
    unitNetPriceCents: 8000,
    taxRate: 19 as const,
    taxCategory: "S" as const,
    discountPermille: 0,
  };
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Workflow GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456780", taxNumber: "33/123/45679" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MCPW-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", ISSUE);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "MCP-Workflow-Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  customerName = customer.name;

  const draft = await createDraftInvoice(
    orgId,
    { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: ISSUE, dueDate: ISSUE, lines: [line("MCP-Workflow-Position")] } as CreateInvoiceInput,
    { now: ISSUE },
  );
  await finalizeInvoice(draft.id, { now: ISSUE });
  invoiceId = draft.id;

  const recurring = await createRecurring(orgId, {
    customerId,
    title: "MCP-Workflow-Abo",
    interval: "MONTHLY",
    intervalCount: 1,
    startDate: ISSUE,
    taxScheme: "REGULAR",
    currency: "EUR",
    paymentTermsDays: 14,
    lines: [line("MCP-Workflow-Abo-Position")],
  } as CreateRecurringInput);
  recurringId = recurring.id;
});

describe("list_invoices", () => {
  it("listet Rechnungen der Organisation, filterbar nach Kunde", async () => {
    const res = await callTool("list_invoices", { customer: customerName });
    expect(res.isError).toBeFalsy();
    const j = JSON.parse(text(res)) as { total: number; rows: Array<{ id: string; customer: string }> };
    expect(j.total).toBe(1);
    expect(j.rows[0].id).toBe(invoiceId);
    expect(j.rows[0].customer).toBe(customerName);
  });

  it("liefert eine Fehlermeldung bei ungueltigem Statuswert", async () => {
    const res = await callTool("list_invoices", { status: "nichtvorhanden" });
    expect(res.isError).toBe(true);
  });
});

describe("get_dashboard", () => {
  it("liefert Dashboard-Kennzahlen der Organisation inkl. der Fix-Runde-1-Kennzahlen (§45)", async () => {
    const res = await callTool("get_dashboard");
    expect(res.isError).toBeFalsy();
    const j = JSON.parse(text(res)) as {
      recentDocuments: unknown[];
      openInvoices: { count: number };
      dueThisWeek: { count: number; cents: number };
      partiallyPaid: { count: number; cents: number };
      dunningRequired: { count: number };
      aging: Array<{ label: string; count: number; cents: number }>;
    };
    expect(Array.isArray(j.recentDocuments)).toBe(true);
    expect(j.recentDocuments.length).toBeGreaterThan(0);
    expect(j.dueThisWeek).toBeDefined();
    expect(j.partiallyPaid).toBeDefined();
    expect(j.dunningRequired).toBeDefined();
    expect(j.aging).toHaveLength(5); // Grenzen 7/30/60/90
  });
});

describe("get_customer_overview", () => {
  it("liefert KPIs + Belegtabs des Kunden", async () => {
    const res = await callTool("get_customer_overview", { customer: customerName });
    expect(res.isError).toBeFalsy();
    const j = JSON.parse(text(res)) as { customer: { id: string }; invoices: unknown[]; recurring: unknown[] };
    expect(j.customer.id).toBe(customerId);
    expect(j.invoices.length).toBe(1);
    expect(j.recurring.length).toBe(1);
  });

  it("liefert eine Fehlermeldung fuer einen unbekannten Kunden", async () => {
    const res = await callTool("get_customer_overview", { customer: "Nicht existent XYZ" });
    expect(res.isError).toBe(true);
  });
});

describe("get_timeline", () => {
  it("liefert den Zeitstrahl einer Rechnung (mind. FINALIZED-Aktivitaet)", async () => {
    const res = await callTool("get_timeline", { kind: "INVOICE", doc: invoiceId });
    expect(res.isError).toBeFalsy();
    const entries = JSON.parse(text(res)) as Array<{ kind: string; label: string }>;
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe("record_payment (+note)", () => {
  it("erfasst eine Zahlung mit Notiz und persistiert diese", async () => {
    const res = await callTool("record_payment", { invoice: invoiceId, amountEuro: 95.2, method: "TRANSFER", note: "Per Überweisung, Referenz MCP-Test" });
    expect(res.isError).toBeFalsy();
    const payment = await dbInternal.payment.findFirst({ where: { invoiceId }, orderBy: { paidAt: "desc" } });
    expect(payment?.note).toBe("Per Überweisung, Referenz MCP-Test");
  });
});

describe("list_notifications / mark_notifications_read", () => {
  it("listet und markiert Benachrichtigungen als gelesen", async () => {
    await createNotification({ orgId, type: "INVOICE_OVERDUE", title: "MCP-Test-Benachrichtigung", dedupeKey: `INVOICE_OVERDUE:${invoiceId}` });

    const listed = await callTool("list_notifications", {});
    expect(listed.isError).toBeFalsy();
    const notifications = JSON.parse(text(listed)) as Array<{ id: string; read: boolean }>;
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.some((n) => !n.read)).toBe(true);

    const marked = await callTool("mark_notifications_read", { all: true });
    expect(marked.isError).toBeFalsy();

    const listedAfter = await callTool("list_notifications", {});
    const notificationsAfter = JSON.parse(text(listedAfter)) as Array<{ read: boolean }>;
    expect(notificationsAfter.every((n) => n.read)).toBe(true);
  });
});

describe("update_recurring_invoice", () => {
  it("aendert Titel, Rhythmus und Zahlungsziel eines bestehenden Abos", async () => {
    const res = await callTool("update_recurring_invoice", { recurring: recurringId, title: "MCP-Workflow-Abo (geändert)", interval: "QUARTERLY", paymentTermsDays: 30 });
    expect(res.isError).toBeFalsy();
    const updated = await dbInternal.recurringInvoice.findUnique({ where: { id: recurringId } });
    expect(updated?.title).toBe("MCP-Workflow-Abo (geändert)");
    expect(updated?.interval).toBe("QUARTERLY");
    expect(updated?.paymentTermsDays).toBe(30);
  });

  it("liefert eine Fehlermeldung fuer ein unbekanntes Abo", async () => {
    const res = await callTool("update_recurring_invoice", { recurring: "does-not-exist", title: "X" });
    expect(res.isError).toBe(true);
  });
});
