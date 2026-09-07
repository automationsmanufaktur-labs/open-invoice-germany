/**
 * buildSimpleLines: reine Positions-Umwandlung (kein Org-Bezug).
 *
 * Fix-Runde 1 zu Task 5: Tests fuer die registrierten MCP-Tools update_invoice_draft,
 * add_attachment, list_attachments, remove_attachment. Die Handler sind nicht einzeln
 * exportiert (server.registerTool haengt sie an server["_registeredTools"][name].handler,
 * "private" nur als TS-Annotation, zur Laufzeit ganz normal zugreifbar) — server selbst
 * ist fuer Tests exportiert. getActiveOrg() wird gemockt (Muster: document-route.test.ts),
 * sonst waere die "aktive Organisation" aus der geteilten Test-DB nicht zuverlaessig
 * diejenige dieses Tests.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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
import { createBusinessDocument } from "@/domain/document/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createInvoiceSchema } from "@/schemas";
import { buildSimpleLines, server } from "@/mcp/server";

describe("buildSimpleLines (MCP)", () => {
  it("übernimmt discountAmount (Euro) als discountCents je Position", async () => {
    const lines = await buildSimpleLines("org-test-mcp", [
      { description: "Beratung", quantity: 2, unitPriceEuro: 100, discountAmount: 5.5 },
    ]);
    expect(lines[0].discountCents).toBe(550);
    expect(lines[0].discountPermille).toBe(0);
  });

  it("kombiniert discountPercent und discountAmount", async () => {
    const lines = await buildSimpleLines("org-test-mcp", [
      { description: "Beratung", quantity: 1, unitPriceEuro: 200, discountPercent: 10, discountAmount: 2 },
    ]);
    expect(lines[0].discountPermille).toBe(100);
    expect(lines[0].discountCents).toBe(200);
  });

  it("ohne discountAmount bleibt discountCents 0", async () => {
    const lines = await buildSimpleLines("org-test-mcp", [{ description: "Beratung", quantity: 1, unitPriceEuro: 50 }]);
    expect(lines[0].discountCents).toBe(0);
  });
});

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}
interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`MCP-Tool "${name}" ist nicht registriert.`);
  return tool.handler(args);
}
function text(result: ToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

describe("MCP-Tools: update_invoice_draft, add_attachment, list_attachments, remove_attachment", () => {
  const FIX_DATE = new Date("2037-07-01T10:00:00.000Z");
  const PDF_BYTES = Buffer.from("%PDF-1.7\nMCP-Testinhalt\n");
  let orgId: string;
  let customerId: string;
  let tmpDir: string;
  let prevEnv: string | undefined;

  beforeAll(async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "MCP-Test GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
    });
    orgId = org.id;
    orgStore.id = orgId;
    await ensureOrgMasterdata(dbInternal, orgId);

    const customer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    customerId = customer.id;
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oig-mcp-attachments-"));
    prevEnv = process.env.ATTACHMENTS_DIR;
    process.env.ATTACHMENTS_DIR = tmpDir;
  });
  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.ATTACHMENTS_DIR;
    else process.env.ATTACHMENTS_DIR = prevEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function draftInvoice() {
    return createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({
        customerId,
        lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }],
      }),
      { now: FIX_DATE },
    );
  }

  describe("update_invoice_draft", () => {
    it("aktualisiert Kopffelder eines Entwurfs", async () => {
      const invoice = await draftInvoice();
      const result = await callTool("update_invoice_draft", { invoice: invoice.id, subject: "Ueber MCP aktualisiert" });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain("Entwurf aktualisiert");

      const reloaded = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(reloaded.subject).toBe("Ueber MCP aktualisiert");
    });

    it("ersetzt Positionen inkl. lineType (HEADING traegt keinen Betrag)", async () => {
      const invoice = await draftInvoice();
      const result = await callTool("update_invoice_draft", {
        invoice: invoice.id,
        lines: [
          { lineType: "HEADING", description: "Ueberschrift" },
          { lineType: "ITEM", description: "Position", quantity: 2, unitPriceEuro: 30 },
        ],
      });
      expect(result.isError).toBeFalsy();

      const lines = await dbInternal.invoiceLine.findMany({ where: { invoiceId: invoice.id }, orderBy: { position: "asc" } });
      expect(lines).toHaveLength(2);
      expect(lines[0].lineType).toBe("HEADING");
      expect(lines[0].lineNetCents).toBe(0);
      expect(lines[1].lineType).toBe("ITEM");
      expect(lines[1].lineNetCents).toBe(6000);
    });

    it("meldet einen Fehler fuer eine festgeschriebene Rechnung (isError)", async () => {
      const invoice = await draftInvoice();
      await dbInternal.invoice.update({ where: { id: invoice.id }, data: { status: "FINALIZED", number: `MCP-${invoice.id}` } });

      const result = await callTool("update_invoice_draft", { invoice: invoice.id, subject: "Sollte scheitern" });
      expect(result.isError).toBe(true);
    });
  });

  describe("add_attachment, list_attachments, remove_attachment", () => {
    it("legt einen Anhang an, listet ihn und entfernt ihn wieder", async () => {
      const invoice = await draftInvoice();
      const contentBase64 = PDF_BYTES.toString("base64");

      const added = await callTool("add_attachment", {
        docType: "INVOICE",
        docId: invoice.id,
        filename: "mcp-anhang.pdf",
        mime: "application/pdf",
        contentBase64,
      });
      expect(added.isError).toBeFalsy();
      expect(text(added)).toContain("mcp-anhang.pdf");

      const listed = await callTool("list_attachments", { docType: "INVOICE", docId: invoice.id });
      expect(listed.isError).toBeFalsy();
      const rows = JSON.parse(text(listed)) as { filename: string; sizeBytes: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].filename).toBe("mcp-anhang.pdf");
      expect(rows[0].sizeBytes).toBe(PDF_BYTES.length);

      const attachmentId = (await dbInternal.documentAttachment.findFirstOrThrow({ where: { orgId, docType: "INVOICE", docId: invoice.id } })).id;
      const removed = await callTool("remove_attachment", { docType: "INVOICE", docId: invoice.id, attachmentId });
      expect(removed.isError).toBeFalsy();

      const listedAfter = await callTool("list_attachments", { docType: "INVOICE", docId: invoice.id });
      expect(text(listedAfter)).toBe("Keine Anhaenge.");
    });

    it("meldet einen Fehler bei ungueltigem Dateiinhalt (Magic-Bytes)", async () => {
      const invoice = await draftInvoice();
      const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00]).toString("base64");

      const result = await callTool("add_attachment", {
        docType: "INVOICE",
        docId: invoice.id,
        filename: "boese.pdf",
        mime: "application/pdf",
        contentBase64: exeBytes,
      });
      expect(result.isError).toBe(true);
    });
  });
});

/**
 * Task 4 — MCP-Tools fuer Teil-/Abschlags-/Schlussrechnungen: dieselben Domain-
 * Funktionen/Zod-Schemas wie die Routen unter /api/documents/[id]/*-invoice (keine
 * Bypass-Pfade, Lastenheft 55). Eigenes Datum/Jahr (2044), um mit anderen Test-
 * Dateien keine Invoice.number-Kollision (global @unique) zu riskieren.
 */
describe("MCP-Tools: create_partial_invoice, create_downpayment_invoice, create_final_invoice, get_billing_state", () => {
  const MCP5_DATE = new Date("2044-07-01T10:00:00.000Z");
  let orgId: string;
  let customerId: string;

  beforeAll(async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "MCP-Teilrechnung GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
    });
    orgId = org.id;
    orgStore.id = orgId;
    await ensureOrgMasterdata(dbInternal, orgId);

    const customer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    customerId = customer.id;
  });

  async function makeQuote() {
    return createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 1_000_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
      },
      { now: MCP5_DATE },
    );
  }

  it("create_partial_invoice: legt eine Teilrechnung (40 %) an", async () => {
    const quote = await makeQuote();
    const result = await callTool("create_partial_invoice", { source: quote.number, mode: "PERCENT", percent: 40 });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/Teilrechnung angelegt/);

    const created = await dbInternal.invoice.findFirst({ where: { orgId, sourceId: quote.id }, orderBy: { createdAt: "desc" } });
    expect(created?.type).toBe("PARTIAL");
    expect(created?.partialPermille).toBe(400);
  });

  it("create_downpayment_invoice: legt eine Abschlagsrechnung (30 %) an, meldet Ueberbuchung nach Festschreiben als Fehler", async () => {
    const quote = await makeQuote();
    const ok1 = await callTool("create_downpayment_invoice", { source: quote.number, mode: "PERCENT", percent: 30 });
    expect(ok1.isError).toBeFalsy();
    // Die 100-%-Grenze zaehlt nur FESTGESCHRIEBENE Abschlaege (Task-2-Ruling) — der erste
    // Abschlag muss dafuer erst festgeschrieben werden, sonst wuerde der zweite Aufruf
    // (Entwurf + Entwurf) noch keine Ueberbuchung sehen.
    const dp1 = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, sourceId: quote.id, type: "DOWNPAYMENT" } });
    await finalizeInvoice(dp1.id, { now: MCP5_DATE });

    const overbook = await callTool("create_downpayment_invoice", { source: quote.number, mode: "PERCENT", percent: 80 });
    expect(overbook.isError).toBe(true);
  });

  it("create_final_invoice: erst nach festgeschriebenem Abschlag moeglich", async () => {
    const quote = await makeQuote();
    const tooEarly = await callTool("create_final_invoice", { source: quote.number });
    expect(tooEarly.isError).toBe(true);

    const dpResult = await callTool("create_downpayment_invoice", { source: quote.number, mode: "PERCENT", percent: 30 });
    expect(dpResult.isError).toBeFalsy();
    const dp = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, sourceId: quote.id, type: "DOWNPAYMENT" } });
    await finalizeInvoice(dp.id, { now: MCP5_DATE });

    const finalResult = await callTool("create_final_invoice", { source: quote.number });
    expect(finalResult.isError).toBeFalsy();
    const final = await dbInternal.invoice.findFirst({ where: { orgId, sourceId: quote.id, type: "FINAL" } });
    expect(final).toBeTruthy();
  });

  it("get_billing_state: NONE ohne, PARTIAL mit 40 % Teilrechnung", async () => {
    const quote = await makeQuote();
    const before = await callTool("get_billing_state", { document: quote.number });
    expect(JSON.parse(text(before)).state).toBe("NONE");

    await callTool("create_partial_invoice", { source: quote.number, mode: "PERCENT", percent: 40 });
    const after = await callTool("get_billing_state", { document: quote.number });
    const parsed = JSON.parse(text(after));
    expect(parsed.state).toBe("PARTIAL");
    expect(parsed.billedPercent).toBe(40);
  });
});

describe("MCP-Tool: set_print_options (S9, Fix-Welle) — Pendant zu PUT .../print-options", () => {
  const FIX_DATE = new Date("2038-04-01T10:00:00.000Z");
  let orgId: string;
  let customerId: string;

  beforeAll(async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "MCP-PrintOptions GmbH", addressLine1: "Hauptstr. 3", postalCode: "21339", city: "Lüneburg", vatId: "DE987654321", taxNumber: "33/987/65432" },
    });
    orgId = org.id;
    orgStore.id = orgId;
    await ensureOrgMasterdata(dbInternal, orgId);
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde S9 AG", addressLine1: "Marktplatz 3", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    customerId = customer.id;
  });

  it("setzt die Ueberschreibung auf einem Rechnungsentwurf (dieselbe Domain-Funktion wie die REST-Route)", async () => {
    const invoice = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );

    const result = await callTool("set_print_options", { kind: "INVOICE", id: invoice.id, options: { showGiroCode: false } });
    expect(result.isError).toBeFalsy();

    const updated = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(JSON.parse(updated.printOptionsJson!)).toEqual({ showGiroCode: false });
  });

  it("lehnt eine festgeschriebene Rechnung ab (kein GoBD-Bypass ueber MCP)", async () => {
    const invoice = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    await finalizeInvoice(invoice.id, { now: FIX_DATE });
    // S6 (Fix-Welle): finalizeInvoice friert die effektiven Druckoptionen bereits ein —
    // hier interessiert nur, dass set_print_options diesen eingefrorenen Stand danach
    // NICHT mehr aendert (kein GoBD-Bypass ueber MCP).
    const beforeAttempt = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });

    const result = await callTool("set_print_options", { kind: "INVOICE", id: invoice.id, options: { showGiroCode: false } });
    expect(result.isError).toBe(true);

    const unchanged = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(unchanged.printOptionsJson).toBe(beforeAttempt.printOptionsJson);
  });

  it("lehnt ein unbekanntes Beleg-Objekt ab (NotFoundError)", async () => {
    const result = await callTool("set_print_options", { kind: "DELIVERY_NOTE", id: "does-not-exist", options: { showFooter: false } });
    expect(result.isError).toBe(true);
  });
});
