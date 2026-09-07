/**
 * Phase 9, Task 2 — MCP-Tools (documents.ts): create_document, list_documents,
 * convert_document_to_invoice, convert_document, create_delivery_note,
 * set_document_status, duplicate_document, create_share_link/revoke_share_link/
 * list_share_links. Muster: mcp-dunning.test.ts (server["_registeredTools"],
 * getActiveOrg gemockt). Eigenes Jahr 2070 (Testjahr-Konvention, plan-header.md:
 * "documents").
 *
 * Quote.number/DeliveryNote.number sind (anders als Invoice.number) NICHT global
 * eindeutig (kein @unique im Schema) — nur fuer INVOICE braucht es einen eigenen
 * NumberRange-Praefix. convert_document_to_invoice/convert_document(toKind=INVOICE)
 * laufen ueber die MCP-Tools ohne "now" (echtes Systemdatum), der Nummernkreis muss also
 * fuer das ECHTE aktuelle Jahr aktiv sein (kein FIX_DATE-Argument bei updateNumberRange,
 * wie in mcp-core.test.ts).
 *
 * AUTH_SECRET (Muster: quote-share.test.ts) noetig fuer create_share_link
 * (encryptSecret/decryptSecret des Klartext-Tokens).
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
let n = 0;

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Documents GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MD70-RE-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test");
});

async function makeCustomer(suffix: string) {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId, name: `MCP-Documents-Kunde ${suffix}-${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  return c;
}

async function makeQuote(customerName: string) {
  const res = await callTool("create_document", {
    kind: "ANGEBOT",
    customer: customerName,
    lines: [{ description: "Beratung", quantity: 2, unitPriceEuro: 150, taxRatePercent: 19 }],
  });
  expect(res.isError).toBeFalsy();
  return dbInternal.quote.findFirstOrThrow({ where: { orgId, customerId: (await dbInternal.customer.findFirstOrThrow({ where: { orgId, name: customerName } })).id } });
}

describe("create_document / list_documents", () => {
  it("create_document legt ein Angebot an (kind=ANGEBOT)", async () => {
    const customer = await makeCustomer("Angebot");
    const res = await callTool("create_document", {
      kind: "ANGEBOT",
      customer: customer.name,
      lines: [{ description: "Beratung", quantity: 2, unitPriceEuro: 150, taxRatePercent: 19 }],
    });
    expect(res.isError).toBeFalsy();
    const quote = await dbInternal.quote.findFirstOrThrow({ where: { orgId, customerId: customer.id } });
    expect(quote.kind).toBe("ANGEBOT");
    expect(quote.status).toBe("DRAFT");
    expect(quote.grossTotalCents).toBe(35700); // 2 * 150€ netto + 19% USt
  });

  it("create_document: Fehlerpfad bei unbekanntem Kunden", async () => {
    const res = await callTool("create_document", {
      kind: "ANGEBOT",
      customer: "Kein-Kunde-XYZ",
      lines: [{ description: "Beratung", quantity: 1, unitPriceEuro: 10 }],
    });
    expect(res.isError).toBe(true);
  });

  it("list_documents findet das angelegte Angebot ueber kind-Filter", async () => {
    const customer = await makeCustomer("Liste");
    const created = await makeQuote(customer.name);
    const res = await callTool("list_documents", { kind: "ANGEBOT" });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(res)) as Array<{ id: string; kind: string }>;
    expect(list.some((d) => d.id === created.id && d.kind === "ANGEBOT")).toBe(true);
  });

  it("list_documents: Fehlerpfad, wenn keine Organisation aktiv ist", async () => {
    const prev = orgStore.id;
    orgStore.id = null;
    try {
      const res = await callTool("list_documents", {});
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/Kein Unternehmen/);
    } finally {
      orgStore.id = prev;
    }
  });
});

describe("create_delivery_note (manuell)", () => {
  it("legt einen Lieferschein ohne Quelldokument an und vergibt sofort eine Nummer", async () => {
    const customer = await makeCustomer("Lieferschein");
    const res = await callTool("create_delivery_note", {
      customer: customer.name,
      lines: [{ description: "Direktlieferung", quantity: 5, unitPriceEuro: 20 }],
      deliveryDate: "heute",
    });
    expect(res.isError).toBeFalsy();
    const note = await dbInternal.deliveryNote.findFirstOrThrow({ where: { orgId, customerId: customer.id } });
    expect(note.status).toBe("CREATED");
    expect(note.number).toBeTruthy();
  });

  it("create_delivery_note: Fehlerpfad bei unbekanntem Kunden", async () => {
    const res = await callTool("create_delivery_note", {
      customer: "Kein-Kunde-XYZ",
      lines: [{ description: "X", quantity: 1, unitPriceEuro: 1 }],
    });
    expect(res.isError).toBe(true);
  });
});

describe("convert_document_to_invoice", () => {
  it("wandelt ein Angebot in einen Rechnungs-Entwurf um", async () => {
    const customer = await makeCustomer("Konvertiert");
    const quote = await makeQuote(customer.name);
    const res = await callTool("convert_document_to_invoice", { document: quote.number ?? quote.id });
    expect(res.isError).toBeFalsy();
    const invoice = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, customerId: customer.id } });
    expect(invoice.status).toBe("DRAFT");
    const relation = await dbInternal.documentRelation.findFirstOrThrow({
      where: { orgId, fromType: "QUOTE", fromId: quote.id, toType: "INVOICE", toId: invoice.id, relationType: "CONVERTED_TO" },
    });
    expect(relation).toBeTruthy();
  });

  it("convert_document_to_invoice: Fehlerpfad bei unbekanntem Dokument", async () => {
    const res = await callTool("convert_document_to_invoice", { document: "unbekannt-md70" });
    expect(res.isError).toBe(true);
  });
});

describe("convert_document (generisch)", () => {
  it("wandelt ein Angebot in eine Auftragsbestaetigung um", async () => {
    const customer = await makeCustomer("ZuAB");
    const quote = await makeQuote(customer.name);
    const res = await callTool("convert_document", { fromType: "QUOTE", document: quote.number ?? quote.id, toKind: "AUFTRAGSBESTAETIGUNG" });
    expect(res.isError).toBeFalsy();
    const ab = await dbInternal.quote.findFirstOrThrow({ where: { orgId, customerId: customer.id, kind: "AUFTRAGSBESTAETIGUNG" } });
    expect(ab.status).toBe("DRAFT");
  });

  it("convert_document: Fehlerpfad bei unbekannter Quelle", async () => {
    const res = await callTool("convert_document", { fromType: "QUOTE", document: "unbekannt-md70", toKind: "INVOICE" });
    expect(res.isError).toBe(true);
  });
});

describe("set_document_status", () => {
  it("setzt ein Angebot auf SENT", async () => {
    const customer = await makeCustomer("Status");
    const quote = await makeQuote(customer.name);
    const res = await callTool("set_document_status", { type: "QUOTE", document: quote.number ?? quote.id, action: "MARK_SENT" });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(reloaded.status).toBe("SENT");
  });

  it("Fehlerpfad: MARK_DELIVERED ist fuer QUOTE nicht gueltig", async () => {
    const customer = await makeCustomer("StatusFehler");
    const quote = await makeQuote(customer.name);
    const res = await callTool("set_document_status", { type: "QUOTE", document: quote.number ?? quote.id, action: "MARK_DELIVERED" });
    expect(res.isError).toBe(true);
  });
});

describe("duplicate_document", () => {
  it("dupliziert ein Angebot als neuen Entwurf", async () => {
    const customer = await makeCustomer("Duplikat");
    const quote = await makeQuote(customer.name);
    const res = await callTool("duplicate_document", { type: "QUOTE", document: quote.number ?? quote.id });
    expect(res.isError).toBeFalsy();
    const copies = await dbInternal.quote.findMany({ where: { orgId, customerId: customer.id } });
    expect(copies.length).toBe(2);
    expect(copies.some((c) => c.id !== quote.id && c.status === "DRAFT")).toBe(true);
  });

  it("duplicate_document: Fehlerpfad bei unbekannter Quelle", async () => {
    const res = await callTool("duplicate_document", { type: "QUOTE", document: "unbekannt-md70" });
    expect(res.isError).toBe(true);
  });
});

describe("create_share_link / list_share_links / revoke_share_link", () => {
  it("erzeugt einen Annahme-Link, listet ihn und widerruft ihn wieder", async () => {
    const customer = await makeCustomer("Sharelink");
    const quote = await makeQuote(customer.name);

    const created = await callTool("create_share_link", { documentId: quote.number ?? quote.id });
    expect(created.isError).toBeFalsy();
    expect(text(created)).toMatch(/Annahme-Link erzeugt/);

    const listed = await callTool("list_share_links", { documentId: quote.number ?? quote.id });
    expect(listed.isError).toBeFalsy();
    expect(text(listed)).toMatch(/aktiv/);

    const link = await dbInternal.quoteShareLink.findFirstOrThrow({ where: { quoteId: quote.id } });
    const revoked = await callTool("revoke_share_link", { linkId: link.id });
    expect(revoked.isError).toBeFalsy();

    const listedAfter = await callTool("list_share_links", { documentId: quote.number ?? quote.id });
    expect(text(listedAfter)).toMatch(/widerrufen/);
  });

  it("create_share_link: Fehlerpfad bei unbekanntem Dokument", async () => {
    const res = await callTool("create_share_link", { documentId: "unbekannt-md70" });
    expect(res.isError).toBe(true);
  });

  it("revoke_share_link: Fehlerpfad bei unbekannter linkId", async () => {
    const res = await callTool("revoke_share_link", { linkId: "unbekannt-md70" });
    expect(res.isError).toBe(true);
  });
});
