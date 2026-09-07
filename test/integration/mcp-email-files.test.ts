/**
 * Phase 9, Task 1 — MCP-Tools: send_email, get_document_file, get_quote,
 * get_delivery_note. Muster: mcp-dunning.test.ts (server["_registeredTools"],
 * getActiveOrg gemockt). send_email nutzt mcpContext.mailProvider (In-Memory,
 * @/lib/mail/memory) statt echtem SMTP/Mailcow (Facts Task 1). Eigenes Jahr 2072
 * (Testjahr-Konvention, plan-header.md: "email/files").
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
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { saveMailSettings } from "@/domain/email/settings";
import { createMemoryProvider } from "@/lib/mail/memory";
import { server, mcpContext } from "@/mcp/server";
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

const FIX_DATE = new Date("2072-05-01T10:00:00.000Z");

let orgId: string;
let customerId: string;
let customerName: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Email-Files GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
  // Invoice.number ist global eindeutig — eigenes Praefix + eigenes Jahr (2072) haelt
  // Kollisionen mit anderen Testdateien fern.
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MC72-RE-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", FIX_DATE);
  await updateNumberRange(orgId, "ANGEBOT", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MC72-ANG-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", FIX_DATE);
  await updateNumberRange(orgId, "DELIVERY_NOTE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MC72-LS-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", FIX_DATE);

  const customer = await dbInternal.customer.create({
    data: {
      orgId,
      name: "MCP-Email-Files-Kunde AG",
      addressLine1: "Marktplatz 2",
      postalCode: "20095",
      city: "Hamburg",
      type: "BUSINESS",
      email: "kunde@example.org",
    },
  });
  customerId = customer.id;
  customerName = customer.name;
});

async function makeFinalizedInvoice() {
  const input: CreateInvoiceInput = {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: FIX_DATE,
    lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
  } as CreateInvoiceInput;
  const draft = await createDraftInvoice(orgId, input);
  return finalizeInvoice(draft.id, { now: FIX_DATE });
}

describe("get_document_file", () => {
  it("liefert eine festgeschriebene Rechnung als Base64-PDF", async () => {
    const inv = await makeFinalizedInvoice();
    const res = await callTool("get_document_file", { kind: "INVOICE", document: inv.number!, format: "pdf" });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(text(res)) as { filename: string; mimeType: string; encoding: string; data: string };
    expect(payload.mimeType).toBe("application/pdf");
    expect(payload.encoding).toBe("base64");
    const bytes = Buffer.from(payload.data, "base64");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("liefert XRechnung-XML fuer eine festgeschriebene Rechnung", async () => {
    const inv = await makeFinalizedInvoice();
    const res = await callTool("get_document_file", { kind: "INVOICE", document: inv.number!, format: "xrechnung" });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(text(res)) as { mimeType: string; data: string };
    expect(payload.mimeType).toBe("application/xml");
    const xml = Buffer.from(payload.data, "base64").toString("utf8");
    expect(xml).toContain("<?xml");
  });

  it("lehnt xrechnung fuer einen Rechnungsentwurf ab", async () => {
    const draft = await createDraftInvoice(orgId, {
      customerId,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Entwurf", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateInvoiceInput);
    const res = await callTool("get_document_file", { kind: "INVOICE", document: draft.id, format: "xrechnung" });
    expect(res.isError).toBe(true);
  });

  it("lehnt format=xrechnung fuer kind=QUOTE ab (nur INVOICE)", async () => {
    const doc = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await callTool("get_document_file", { kind: "QUOTE", document: doc.number!, format: "xrechnung" });
    expect(res.isError).toBe(true);
  });

  it("liefert ein Angebot als Base64-PDF", async () => {
    const doc = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await callTool("get_document_file", { kind: "QUOTE", document: doc.number!, format: "pdf" });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(text(res)) as { data: string };
    expect(Buffer.from(payload.data, "base64").subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("liefert einen Lieferschein als Base64-PDF", async () => {
    const note = await createDeliveryNote(orgId, {
      customerId,
      deliveryDate: FIX_DATE,
      lines: [{ description: "Warenlieferung", quantityMilli: 2000, unitNetPriceCents: 1000, taxRate: 19, taxCategory: "S" }],
    });
    const res = await callTool("get_document_file", { kind: "DELIVERY_NOTE", document: note.number!, format: "pdf" });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(text(res)) as { data: string };
    expect(Buffer.from(payload.data, "base64").subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("Fehlerpfad: unbekannter Beleg", async () => {
    const res = await callTool("get_document_file", { kind: "INVOICE", document: "unbekannt-123", format: "pdf" });
    expect(res.isError).toBe(true);
  });
});

describe("get_quote / get_delivery_note", () => {
  it("get_quote zeigt Details eines Angebots", async () => {
    const doc = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Beratung", quantityMilli: 2000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await callTool("get_quote", { document: doc.number! });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(text(res)) as { number: string; kind: string; customer: string };
    expect(payload.number).toBe(doc.number);
    expect(payload.kind).toBe("ANGEBOT");
    expect(payload.customer).toBe(customerName);
  });

  it("get_quote: Fehlerpfad bei unbekanntem Dokument", async () => {
    const res = await callTool("get_quote", { document: "unbekannt-123" });
    expect(res.isError).toBe(true);
  });

  it("get_delivery_note zeigt Details eines Lieferscheins", async () => {
    const note = await createDeliveryNote(orgId, {
      customerId,
      deliveryDate: FIX_DATE,
      lines: [{ description: "Warenlieferung", quantityMilli: 3000, unitNetPriceCents: 500, taxRate: 19, taxCategory: "S" }],
    });
    const res = await callTool("get_delivery_note", { document: note.number! });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(text(res)) as { number: string; customer: string };
    expect(payload.number).toBe(note.number);
    expect(payload.customer).toBe(customerName);
  });

  it("get_delivery_note: Fehlerpfad bei unbekanntem Lieferschein", async () => {
    const res = await callTool("get_delivery_note", { document: "unbekannt-123" });
    expect(res.isError).toBe(true);
  });
});

describe("send_email", () => {
  beforeAll(async () => {
    await saveMailSettings(orgId, {
      host: "localhost",
      port: 2525,
      security: "NONE",
      fromName: "MCP-Email-Files Test GmbH",
      fromEmail: "rechnung@example.org",
      defaultCc: "",
      defaultBcc: "",
      copyToSelf: false,
    });
  });

  it("versendet eine festgeschriebene Rechnung ueber den injizierten MemoryMailProvider", async () => {
    const provider = createMemoryProvider();
    mcpContext.mailProvider = provider;
    try {
      const inv = await makeFinalizedInvoice();
      const res = await callTool("send_email", {
        docType: "INVOICE",
        docId: inv.number!,
        to: ["kunde@example.org"],
        subject: "Ihre Rechnung",
        body: "Anbei die Rechnung.",
      });
      expect(res.isError).toBeFalsy();
      expect(text(res)).toContain("versendet");
      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]!.to).toEqual(["kunde@example.org"]);
      expect(provider.sent[0]!.subject).toBe("Ihre Rechnung");

      const log = await dbInternal.emailLog.findFirst({ where: { orgId, docId: inv.id, docType: "INVOICE" } });
      expect(log).not.toBeNull();
      expect(log?.status).toBe("SENT");
    } finally {
      mcpContext.mailProvider = undefined;
    }
  });

  it("Fehlerpfad: unbekannter Beleg", async () => {
    const provider = createMemoryProvider();
    mcpContext.mailProvider = provider;
    try {
      const res = await callTool("send_email", {
        docType: "INVOICE",
        docId: "unbekannt-123",
        to: ["kunde@example.org"],
        subject: "X",
        body: "Y",
      });
      expect(res.isError).toBe(true);
      expect(provider.sent).toHaveLength(0);
    } finally {
      mcpContext.mailProvider = undefined;
    }
  });

  it("Fehlerpfad: MAIL_NOT_CONFIGURED, wenn keine Mail-Einstellungen existieren (andere Org)", async () => {
    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "MCP-Email-Files ohne Mail GmbH", addressLine1: "Weg 2", postalCode: "10115", city: "Berlin", vatId: "DE111111111", taxNumber: "11/111/11111" },
    });
    await ensureOrgMasterdata(dbInternal, otherOrg.id);
    const otherCustomer = await dbInternal.customer.create({
      data: { orgId: otherOrg.id, name: "Ohne-Mail-Kunde", addressLine1: "X", postalCode: "1", city: "Y", type: "BUSINESS", email: "x@example.org" },
    });
    await updateNumberRange(otherOrg.id, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MC72B-RE-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", FIX_DATE);
    const draft = await createDraftInvoice(otherOrg.id, {
      customerId: otherCustomer.id,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      deliveryDate: FIX_DATE,
      lines: [{ description: "X", quantityMilli: 1000, unitNetPriceCents: 1000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateInvoiceInput);
    const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });

    orgStore.id = otherOrg.id;
    try {
      const res = await callTool("send_email", {
        docType: "INVOICE",
        docId: fin.number!,
        to: ["x@example.org"],
        subject: "X",
        body: "Y",
      });
      expect(res.isError).toBe(true);
    } finally {
      orgStore.id = orgId;
    }
  });
});
