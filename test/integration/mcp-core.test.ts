/**
 * Phase 9, Task 1 — MCP-Tools: update_customer, archive_customer, update_product,
 * archive_product, upsert_product-Paritaet (productSchema/differential §25a),
 * set_recurring_state. Muster: mcp-customer.test.ts (server["_registeredTools"],
 * getActiveOrg gemockt). Eigenes Jahr 2069 (Testjahr-Konvention, plan-header.md).
 *
 * Phase 9, Task 2 — erweitert (Facts task-2-facts.md: mcp-core.test.ts ERWEITERN, nicht
 * neu anlegen) um: get_status, setup_company, list_customers/upsert_customer,
 * list_products/upsert_product, create_invoice/finalize_invoice/cancel_invoice/
 * credit_invoice/get_invoice/export_invoice. Eigener NumberRange-Praefix "MC69-RE-" fuer
 * INVOICE (Jahr 2069, Invoice.number global eindeutig). list_invoices bereits seit
 * Phase 8b in mcp-workflow.test.ts getestet (facts.md) — hier nicht dupliziert.
 *
 * Testbarkeit-Fixes (dokumentiert in task-2-report.md): list_customers/list_products
 * (src/mcp/tools/customers.ts, products.ts) filterten bisher NICHT nach orgId (listeten
 * ueber alle Organisationen der geteilten Test-DB hinweg) — auf ctx.requireOrg()+orgId
 * umgestellt, wie jedes andere Kunden-/Produkt-Tool. get_status/list_documents/
 * list_recurring (system.ts/documents.ts/recurring.ts) nutzten ungescoptes
 * dbInternal.organization.findFirst() statt ctx.requireOrg() (respektiert die in Tests
 * gemockte aktive Org) — get_status zaehlte zudem global statt orgId-gescopt.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
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
import { createRecurring } from "@/domain/recurring/create";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { server } from "@/mcp/server";
import type { CreateRecurringInput } from "@/schemas";

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

const FIX_DATE = new Date("2069-03-01T10:00:00.000Z");

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Core GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
  // Invoice.number ist global eindeutig (siehe mcp-workflow.test.ts/mcp-email-files.test.ts) —
  // eigener Praefix haelt Kollisionen mit anderen Testdateien fern (Task 2). Die MCP-Tools
  // create_invoice/finalize_invoice geben (anders als die Domain-Direktaufrufe oben mit
  // FIX_DATE) kein "now" durch und nummerieren daher mit dem echten Systemdatum — der
  // Nummernkreis muss also fuer das ECHTE aktuelle Jahr aktiv sein (kein FIX_DATE-Argument,
  // Default now = new Date()).
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MC69-RE-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test");
  // Storno-/Teilgutschriften (cancel_invoice/credit_invoice) numerieren ueber einen EIGENEN
  // Nummernkreis docType=CREDIT_NOTE (finalize.ts: docType = invoice.type === "CREDIT_NOTE"
  // ? "CREDIT_NOTE" : "INVOICE") — ohne eigenen Praefix kollidierte das reale aktuelle Jahr
  // (2026) mit dem Default-Praefix anderer Tests, die (mit eigenem FIX_DATE) ebenfalls
  // Gutschriften in 2026 festschreiben, z. B. test/integration/gobd.test.ts (nicht
  // deterministisch reproduzierbar, aber im vollen Testlauf beobachtet: "Unique constraint
  // failed on the fields: (`number`)" abwechselnd in beiden Dateien, je nachdem wer zuerst
  // inserted — echte Ursache gefunden per Debug-Instrumentierung, siehe task-2-report.md).
  await updateNumberRange(orgId, "CREDIT_NOTE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MC69-GS-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test");
});

describe("update_customer / archive_customer", () => {
  let customerId: string;
  let customerName: string;

  it("legt einen Kunden per upsert_customer an (Vorbereitung)", async () => {
    customerName = "MCP-Core-Kunde AG";
    const res = await callTool("upsert_customer", {
      name: customerName,
      addressLine1: "Marktplatz 2",
      postalCode: "20095",
      city: "Hamburg",
    });
    expect(res.isError).toBeFalsy();
    const c = await dbInternal.customer.findFirstOrThrow({ where: { orgId, name: customerName } });
    customerId = c.id;
  });

  it("update_customer aktualisiert nur die angegebenen Felder", async () => {
    const res = await callTool("update_customer", { customer: customerId, city: "Berlin", vatId: "DE987654321" });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(reloaded.city).toBe("Berlin");
    expect(reloaded.vatId).toBe("DE987654321");
    // unveraendert gebliebene Felder
    expect(reloaded.addressLine1).toBe("Marktplatz 2");
    expect(reloaded.name).toBe(customerName);
  });

  it("update_customer: Fehlerpfad bei unbekanntem Kunden", async () => {
    const res = await callTool("update_customer", { customer: "unbekannt-xyz", city: "Nirgendwo" });
    expect(res.isError).toBe(true);
  });

  it("update_customer: lehnt eine ungueltige E-Mail-Adresse ab (Fix-Runde 1 — customerSchema statt inline-Zod)", async () => {
    const res = await callTool("update_customer", { customer: customerId, email: "keine-email" });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/[Vv]alidierung/);
    // Feld bleibt unveraendert (kein Teil-Update bei fehlgeschlagener Validierung)
    const reloaded = await dbInternal.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(reloaded.email).not.toBe("keine-email");
  });

  it("archive_customer setzt isArchived und blendet den Kunden aus list_customers aus", async () => {
    const res = await callTool("archive_customer", { customer: customerId });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(reloaded.isArchived).toBe(true);

    const list = JSON.parse(text(await callTool("list_customers", {})));
    expect((list as { id: string }[]).some((c) => c.id === customerId)).toBe(false);
  });

  it("archive_customer: Fehlerpfad bei unbekanntem Kunden", async () => {
    const res = await callTool("archive_customer", { customer: "unbekannt-xyz" });
    expect(res.isError).toBe(true);
  });
});

describe("update_product / archive_product / upsert_product-Paritaet", () => {
  let productId: string;
  let productName: string;

  it("legt ein Produkt per upsert_product mit differential=true an (§25a-Paritaet)", async () => {
    productName = "MCP-Core-Produkt (differenzbesteuert)";
    const res = await callTool("upsert_product", { name: productName, netPriceEuro: 42, differential: true });
    expect(res.isError).toBeFalsy();
    const p = await dbInternal.product.findFirstOrThrow({ where: { orgId, name: productName } });
    productId = p.id;
    // Paritaet mit saveProduct/createProductInline: productSchema traegt "differential" —
    // vor dem Fix (eigenes inline-Zod ohne dieses Feld) ging es am MCP-Pfad verloren.
    expect(p.differential).toBe(true);
  });

  it("update_product aktualisiert nur die angegebenen Felder", async () => {
    const res = await callTool("update_product", { product: productId, netPriceEuro: 55.5, unit: "HUR" });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.product.findUniqueOrThrow({ where: { id: productId } });
    expect(reloaded.netPriceCents).toBe(5550);
    expect(reloaded.unit).toBe("HUR");
    // unveraendert: differential und name
    expect(reloaded.differential).toBe(true);
    expect(reloaded.name).toBe(productName);
  });

  it("update_product: Fehlerpfad bei unbekanntem Produkt", async () => {
    const res = await callTool("update_product", { product: "unbekannt-xyz", netPriceEuro: 1 });
    expect(res.isError).toBe(true);
  });

  it("archive_product setzt isArchived und blendet das Produkt aus list_products aus", async () => {
    const res = await callTool("archive_product", { product: productId });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.product.findUniqueOrThrow({ where: { id: productId } });
    expect(reloaded.isArchived).toBe(true);

    const list = JSON.parse(text(await callTool("list_products", {})));
    expect((list as { id: string }[]).some((p) => p.id === productId)).toBe(false);
  });

  it("archive_product: Fehlerpfad bei unbekanntem Produkt", async () => {
    const res = await callTool("archive_product", { product: "unbekannt-xyz" });
    expect(res.isError).toBe(true);
  });
});

describe("set_recurring_state", () => {
  let recurringId: string;

  it("legt ein Abo an (Vorbereitung)", async () => {
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "MCP-Core-Abo-Kunde AG", addressLine1: "Abo-Weg 1", postalCode: "10115", city: "Berlin", type: "BUSINESS" },
    });
    const input: CreateRecurringInput = {
      customerId: customer.id,
      title: "MCP-Core-Testabo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Wartung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateRecurringInput;
    const rec = await createRecurring(orgId, input);
    recurringId = rec.id;
    expect(rec.status).toBe("ACTIVE");
  });

  it("pausiert das Abo (Wrapper um update_recurring_invoice, dieselbe Domain-Funktion)", async () => {
    const res = await callTool("set_recurring_state", { recurring: recurringId, state: "PAUSED" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain("PAUSED");
    const reloaded = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: recurringId } });
    expect(reloaded.status).toBe("PAUSED");
  });

  it("setzt das Abo wieder auf ACTIVE", async () => {
    const res = await callTool("set_recurring_state", { recurring: recurringId, state: "ACTIVE" });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: recurringId } });
    expect(reloaded.status).toBe("ACTIVE");
  });

  it("beendet das Abo (ENDED)", async () => {
    const res = await callTool("set_recurring_state", { recurring: recurringId, state: "ENDED" });
    expect(res.isError).toBeFalsy();
    const reloaded = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: recurringId } });
    expect(reloaded.status).toBe("ENDED");
  });

  it("Fehlerpfad: unbekanntes Abo", async () => {
    const res = await callTool("set_recurring_state", { recurring: "unbekannt-xyz", state: "PAUSED" });
    expect(res.isError).toBe(true);
  });

  it("Fehlerpfad: mehrdeutiger Titel (zwei Substring-Treffer) — Fehler nennt beide Namen, kein Statuswechsel (Fix-Welle Punkt 1)", async () => {
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "MCP-Core-Abo-Kunde-Mehrdeutig AG", addressLine1: "Abo-Weg 2", postalCode: "10115", city: "Berlin", type: "BUSINESS" },
    });
    const baseInput: CreateRecurringInput = {
      customerId: customer.id,
      title: "Wartung Müller",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Wartung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateRecurringInput;
    const recA = await createRecurring(orgId, baseInput);
    const recB = await createRecurring(orgId, { ...baseInput, title: "Wartung Müller Süd" });
    expect(recA.status).toBe("ACTIVE");
    expect(recB.status).toBe("ACTIVE");

    const res = await callTool("set_recurring_state", { recurring: "Müller", state: "PAUSED" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Wartung Müller");
    expect(text(res)).toContain("Wartung Müller Süd");

    const reloadedA = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: recA.id } });
    const reloadedB = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: recB.id } });
    expect(reloadedA.status).toBe("ACTIVE");
    expect(reloadedB.status).toBe("ACTIVE");
  });
});

describe("get_status", () => {
  it("meldet companyConfigured=true und liefert auf die aktive Org gescopte Zaehler", async () => {
    const res = await callTool("get_status", {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(text(res)) as { companyConfigured: boolean; company: { legalName: string } | null; counts: Record<string, number> };
    expect(parsed.companyConfigured).toBe(true);
    expect(parsed.company?.legalName).toBe("MCP-Core GmbH");
    // Testbarkeit-Fix (system.ts): Zaehler sind jetzt orgId-gescopt statt global ueber
    // alle Organisationen der geteilten Test-DB — direkter Vergleich mit derselben Query.
    const [customers, products, invoices] = await Promise.all([
      dbInternal.customer.count({ where: { orgId, isArchived: false } }),
      dbInternal.product.count({ where: { orgId, isArchived: false } }),
      dbInternal.invoice.count({ where: { orgId } }),
    ]);
    expect(parsed.counts.customers).toBe(customers);
    expect(parsed.counts.products).toBe(products);
    expect(parsed.counts.invoices).toBe(invoices);
  });

  it("meldet companyConfigured=false ohne Fehler, wenn keine Organisation aktiv ist", async () => {
    const prev = orgStore.id;
    orgStore.id = null;
    try {
      const res = await callTool("get_status", {});
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(text(res)) as { companyConfigured: boolean; counts: Record<string, number> };
      expect(parsed.companyConfigured).toBe(false);
      expect(parsed.counts).toEqual({ customers: 0, products: 0, invoices: 0, drafts: 0 });
    } finally {
      orgStore.id = prev;
    }
  });
});

describe("setup_company", () => {
  it("legt an oder aktualisiert (Match unabhaengig davon, welche Org global 'die erste' der geteilten Test-DB ist) und persistiert die Angaben", async () => {
    const res = await callTool("setup_company", {
      legalName: "MCP-Core-Setup GmbH (Task 2)",
      addressLine1: "Setupweg 9",
      postalCode: "10999",
      city: "Berlin",
      taxNumber: "99/999/99999",
    });
    expect(res.isError).toBeFalsy();
    const match = text(res).match(/\(([^)]+)\)\.\s*$/);
    expect(match).toBeTruthy();
    const touched = await dbInternal.organization.findUniqueOrThrow({ where: { id: match![1] } });
    expect(touched.legalName).toBe("MCP-Core-Setup GmbH (Task 2)");
    expect(touched.postalCode).toBe("10999");
    expect(touched.taxNumber).toBe("99/999/99999");
  });

  it("Fehlerpfad: Validierung schlaegt bei fehlender Postleitzahl fehl (organizationSchema)", async () => {
    const res = await callTool("setup_company", { legalName: "X-GmbH", addressLine1: "Y-Weg 1", city: "Z-Stadt" });
    expect(res.isError).toBe(true);
  });
});

describe("list_customers / upsert_customer (Task 2)", () => {
  it("legt einen Kunden per upsert_customer an und findet ihn ueber list_customers wieder", async () => {
    const name = "MCP-Core-Listenkunde AG";
    const res = await callTool("upsert_customer", {
      name,
      addressLine1: "Listenweg 3",
      postalCode: "30159",
      city: "Hannover",
      vatId: "DE111222333",
    });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_customers", {}))) as Array<{ id: string; name: string; city: string; vatId: string | null }>;
    const found = list.find((c) => c.name === name);
    expect(found).toBeTruthy();
    expect(found?.city).toBe("Hannover");
    expect(found?.vatId).toBe("DE111222333");
  });

  it("upsert_customer: Fehlerpfad bei fehlender Postleitzahl (customerSchema)", async () => {
    const res = await callTool("upsert_customer", { name: "MCP-Core-Ungueltig AG", addressLine1: "X" });
    expect(res.isError).toBe(true);
  });
});

describe("list_products / upsert_product (Task 2)", () => {
  it("legt ein Produkt per upsert_product an und findet es ueber list_products wieder", async () => {
    const name = "MCP-Core-Listenprodukt";
    const res = await callTool("upsert_product", { name, netPriceEuro: 12.34, taxRatePercent: 7 });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_products", {}))) as Array<{ id: string; name: string; taxRate: number }>;
    const found = list.find((p) => p.name === name);
    expect(found).toBeTruthy();
    expect(found?.taxRate).toBe(7);
  });

  it("upsert_product: Fehlerpfad bei ungueltigem taxRatePercent (TaxRate-Union)", async () => {
    const res = await callTool("upsert_product", { name: "MCP-Core-Ungueltiges-Produkt", netPriceEuro: 10, taxRatePercent: 15 });
    expect(res.isError).toBe(true);
  });
});

describe("list_customers / list_products: kein Mandanten-Leck (Fix-Welle Punkt 3)", () => {
  it("zeigt keine Kunden/Produkte einer fremden Organisation", async () => {
    // Zweite Organisation in derselben (geteilten) Test-DB — list_customers/list_products
    // filterten vor Task 2 NICHT nach orgId (echtes Mandanten-Leck, siehe task-2-report.md).
    // Regressionstest dafuer (Fix-Welle Punkt 3).
    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "MCP-Core-Fremdorg GmbH", addressLine1: "Fremdweg 1", postalCode: "99999", city: "Fremdstadt", vatId: "DE999999999", taxNumber: "11/111/11111" },
    });
    const otherCustomer = await dbInternal.customer.create({
      data: { orgId: otherOrg.id, name: "MCP-Core-Fremdkunde AG", addressLine1: "X", postalCode: "1", city: "Y", type: "BUSINESS" },
    });
    const otherProduct = await dbInternal.product.create({
      data: { orgId: otherOrg.id, name: "MCP-Core-Fremdprodukt", articleNumber: "FREMD-1", unit: "C62", netPriceCents: 1000, taxRate: 19, taxCategory: "S" },
    });

    const customers = JSON.parse(text(await callTool("list_customers", {}))) as Array<{ id: string }>;
    const products = JSON.parse(text(await callTool("list_products", {}))) as Array<{ id: string }>;
    expect(customers.some((c) => c.id === otherCustomer.id)).toBe(false);
    expect(products.some((p) => p.id === otherProduct.id)).toBe(false);
  });
});

describe("failUnknown (Fix-Welle Punkt 6): unbekannte Fehler generisch, kein Rohtext", () => {
  it("ein gemockter DB-Fehler liefert eine generische Antwort statt der Rohnachricht", async () => {
    const spy = vi.spyOn(dbInternal.customer, "findMany").mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:5432 — Interna, die niemals im Chat landen duerfen"));
    try {
      const res = await callTool("upsert_customer", {
        name: "MCP-Core-DB-Fehler-Kunde AG",
        addressLine1: "Fehlerweg 1",
        postalCode: "12345",
        city: "Fehlerstadt",
      });
      expect(res.isError).toBe(true);
      expect(text(res)).toBe("Unerwarteter Fehler — Details im Serverlog.");
      expect(text(res)).not.toContain("ECONNREFUSED");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("create_invoice / finalize_invoice / get_invoice / export_invoice / credit_invoice (Task 2)", () => {
  let customerId: string;
  let customerName: string;
  let invoiceId: string;
  let invoiceNumber: string;
  let tmpDir: string;

  async function makeCustomer(suffix: string) {
    const c = await dbInternal.customer.create({
      data: { orgId, name: `MCP-Core-Rechnungskunde ${suffix} AG`, addressLine1: "Rechnungsweg 1", postalCode: "50667", city: "Köln", type: "BUSINESS" },
    });
    return c;
  }

  beforeAll(async () => {
    const c = await makeCustomer("A");
    customerId = c.id;
    customerName = c.name;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oig-mcp-core-export-"));
  });

  it("create_invoice legt einen Entwurf an", async () => {
    const res = await callTool("create_invoice", {
      customer: customerName,
      lines: [{ description: "Beratung", quantity: 3, unitPriceEuro: 100, taxRatePercent: 19 }],
      deliveryDate: "heute",
    });
    expect(res.isError).toBeFalsy();
    const draft = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, customerId, status: "DRAFT" } });
    invoiceId = draft.id;
    expect(draft.grossTotalCents).toBe(35700); // 3 * 100€ netto + 19% USt
  });

  it("create_invoice: Fehlerpfad bei unbekanntem Kunden", async () => {
    const res = await callTool("create_invoice", {
      customer: "Kein-Kunde-XYZ",
      lines: [{ description: "Beratung", quantity: 1, unitPriceEuro: 10 }],
    });
    expect(res.isError).toBe(true);
  });

  it("finalize_invoice schreibt fest und vergibt die Rechnungsnummer (eigener Praefix MC69-RE-)", async () => {
    const res = await callTool("finalize_invoice", { invoice: invoiceId });
    expect(res.isError).toBeFalsy();
    const finalized = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.number).toMatch(/^MC69-RE-/);
    invoiceNumber = finalized.number!;
  });

  it("finalize_invoice: Fehlerpfad bei unbekannter Rechnung", async () => {
    const res = await callTool("finalize_invoice", { invoice: "unbekannt-mc69" });
    expect(res.isError).toBe(true);
  });

  it("get_invoice zeigt die festgeschriebene Rechnung", async () => {
    const res = await callTool("get_invoice", { invoice: invoiceNumber });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(text(res)) as { number: string; status: string; customer: string; gross: string };
    expect(parsed.number).toBe(invoiceNumber);
    expect(parsed.status).toBe("FINALIZED");
    expect(parsed.customer).toBe(customerName);
  });

  it("get_invoice: Fehlerpfad bei unbekannter Rechnung", async () => {
    const res = await callTool("get_invoice", { invoice: "unbekannt-mc69" });
    expect(res.isError).toBe(true);
  });

  it("export_invoice schreibt eine PDF-Datei ins angegebene Zielverzeichnis", async () => {
    const res = await callTool("export_invoice", { invoice: invoiceNumber, format: "pdf", outputDir: tmpDir });
    expect(res.isError).toBeFalsy();
    const expectedPath = path.join(tmpDir, `${invoiceNumber}.pdf`);
    expect(text(res)).toContain(expectedPath);
    const stat = await fs.stat(expectedPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("export_invoice schreibt eine validierte XRechnung-XML fuer die festgeschriebene Rechnung", async () => {
    const res = await callTool("export_invoice", { invoice: invoiceNumber, format: "xrechnung", outputDir: tmpDir });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/BESTANDEN/);
    const xmlPath = path.join(tmpDir, `${invoiceNumber}.xml`);
    const xml = await fs.readFile(xmlPath, "utf8");
    expect(xml).toContain(invoiceNumber);
  });

  it("export_invoice: Fehlerpfad bei unbekannter Rechnung", async () => {
    const res = await callTool("export_invoice", { invoice: "unbekannt-mc69", outputDir: tmpDir });
    expect(res.isError).toBe(true);
  });

  it("credit_invoice erstellt eine Teilgutschrift ueber eine Position", async () => {
    const res = await callTool("credit_invoice", {
      invoice: invoiceNumber,
      lines: [{ description: "Teilerstattung Beratung", quantity: 1, unitPriceEuro: 100, taxRatePercent: 19 }],
      notes: "Kulanz",
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/Teilgutschrift/);
    const creditNote = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, type: "CREDIT_NOTE", correctsInvoiceId: invoiceId } });
    expect(creditNote.grossTotalCents).toBe(-11900); // Betragsspiegelbild: negiert (100€ netto + 19% USt)
  });

  it("credit_invoice: Fehlerpfad bei unbekannter Rechnung", async () => {
    const res = await callTool("credit_invoice", {
      invoice: "unbekannt-mc69",
      lines: [{ description: "X", quantity: 1, unitPriceEuro: 1 }],
    });
    expect(res.isError).toBe(true);
  });
});

describe("cancel_invoice (Task 2)", () => {
  let invoiceId: string;
  let invoiceNumber: string;

  beforeAll(async () => {
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "MCP-Core-Storno-Kunde AG", addressLine1: "Stornoweg 1", postalCode: "50667", city: "Köln", type: "BUSINESS" },
    });
    const created = await callTool("create_invoice", {
      customer: customer.name,
      lines: [{ description: "Wartung", quantity: 1, unitPriceEuro: 200, taxRatePercent: 19 }],
      deliveryDate: "heute",
    });
    expect(created.isError).toBeFalsy();
    const draft = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, customerId: customer.id, status: "DRAFT" } });
    invoiceId = draft.id;
    const finalized = await callTool("finalize_invoice", { invoice: invoiceId });
    expect(finalized.isError).toBeFalsy();
    invoiceNumber = (await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).number!;
  });

  it("storniert die festgeschriebene Rechnung mit einer Storno-Gutschrift", async () => {
    const res = await callTool("cancel_invoice", { invoice: invoiceNumber });
    expect(res.isError).toBeFalsy();
    const original = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(original.status).toBe("CANCELLED");
    const creditNote = await dbInternal.invoice.findFirstOrThrow({ where: { orgId, type: "CREDIT_NOTE", correctsInvoiceId: invoiceId } });
    expect(creditNote.status).toBe("FINALIZED");
  });

  it("cancel_invoice: Fehlerpfad bei unbekannter Rechnung", async () => {
    const res = await callTool("cancel_invoice", { invoice: "unbekannt-mc69" });
    expect(res.isError).toBe(true);
  });
});
