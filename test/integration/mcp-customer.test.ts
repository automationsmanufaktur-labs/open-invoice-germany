/**
 * Phase 8a, Task 3 — MCP-Tools: list_customer_addresses, upsert_customer_address,
 * delete_customer_address, list_contact_persons, upsert_contact_person,
 * delete_contact_person, update_customer_defaults, list_custom_fields,
 * upsert_custom_field, set_customer_custom_fields, take_over_last_document (§55).
 * Muster: mcp-settings.test.ts (server["_registeredTools"], getActiveOrg gemockt).
 * Eigenes Jahr 2062 (Testjahr-Konvention).
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

const ISSUE = new Date("2062-04-01T10:00:00.000Z");

let orgId: string;
let customerName: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "MCP-Kunden GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "MTV-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", ISSUE);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "MCP-Test-Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerName = customer.name;
});

describe("list_customer_addresses / upsert_customer_address / delete_customer_address", () => {
  let addressId: string;

  it("liefert eine leere Liste zu Beginn", async () => {
    const res = await callTool("list_customer_addresses", { customer: customerName });
    expect(JSON.parse(text(res))).toEqual([]);
  });

  it("legt eine Adresse an", async () => {
    const res = await callTool("upsert_customer_address", {
      customer: customerName,
      type: "BILLING",
      addressLine1: "Rechnungsweg 1",
      postalCode: "10115",
      city: "Berlin",
      isDefault: true,
    });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_customer_addresses", { customer: customerName })));
    expect(list.length).toBe(1);
    addressId = list[0].id;
  });

  it("aktualisiert die Adresse (mit id)", async () => {
    const res = await callTool("upsert_customer_address", {
      customer: customerName,
      id: addressId,
      type: "BILLING",
      addressLine1: "Neuer Weg 5",
      postalCode: "10117",
      city: "Berlin",
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/Neuer Weg 5/);
  });

  it("meldet einen unbekannten Kunden als Fehler", async () => {
    const res = await callTool("upsert_customer_address", { customer: "Nicht existent XYZ", type: "BILLING", addressLine1: "X", postalCode: "1", city: "Y" });
    expect(res.isError).toBe(true);
  });

  it("loescht die Adresse", async () => {
    const res = await callTool("delete_customer_address", { customer: customerName, id: addressId });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_customer_addresses", { customer: customerName })));
    expect(list.length).toBe(0);
  });
});

describe("set_default_address (Nit, Fix-Welle)", () => {
  it("setzt eine Adresse als Default ihres Typs und verdraengt den bisherigen Default", async () => {
    const a1 = JSON.parse(
      text(
        await callTool("upsert_customer_address", { customer: customerName, type: "SHIPPING", addressLine1: "Lager A", postalCode: "10115", city: "Berlin", isDefault: true }),
      ).replace("Adresse gespeichert: ", ""),
    );
    const a2 = JSON.parse(
      text(await callTool("upsert_customer_address", { customer: customerName, type: "SHIPPING", addressLine1: "Lager B", postalCode: "10117", city: "Berlin" })).replace(
        "Adresse gespeichert: ",
        "",
      ),
    );

    const res = await callTool("set_default_address", { customer: customerName, id: a2.id });
    expect(res.isError).toBeFalsy();

    const list = JSON.parse(text(await callTool("list_customer_addresses", { customer: customerName })));
    const found1 = list.find((a: { id: string }) => a.id === a1.id);
    const found2 = list.find((a: { id: string }) => a.id === a2.id);
    expect(found1.isDefault).toBe(false);
    expect(found2.isDefault).toBe(true);

    await callTool("delete_customer_address", { customer: customerName, id: a1.id });
    await callTool("delete_customer_address", { customer: customerName, id: a2.id });
  });

  it("meldet eine unbekannte Adress-ID als Fehler", async () => {
    const res = await callTool("set_default_address", { customer: customerName, id: "nicht-vorhanden" });
    expect(res.isError).toBe(true);
  });
});

describe("list_contact_persons / upsert_contact_person / delete_contact_person", () => {
  let contactId: string;

  it("legt einen Ansprechpartner an", async () => {
    const res = await callTool("upsert_contact_person", { customer: customerName, firstName: "Anna", lastName: "Muster", isDefault: true });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_contact_persons", { customer: customerName })));
    expect(list.length).toBe(1);
    contactId = list[0].id;
  });

  it("set_default_contact (Nit, Fix-Welle): setzt einen zweiten Ansprechpartner als Default", async () => {
    const res2 = await callTool("upsert_contact_person", { customer: customerName, firstName: "Bert", lastName: "Beispiel" });
    expect(res2.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_contact_persons", { customer: customerName })));
    const bert = list.find((c: { firstName: string }) => c.firstName === "Bert");

    const res = await callTool("set_default_contact", { customer: customerName, id: bert.id });
    expect(res.isError).toBeFalsy();

    const listAfter = JSON.parse(text(await callTool("list_contact_persons", { customer: customerName })));
    expect(listAfter.find((c: { id: string }) => c.id === contactId).isDefault).toBe(false);
    expect(listAfter.find((c: { id: string }) => c.id === bert.id).isDefault).toBe(true);

    await callTool("delete_contact_person", { customer: customerName, id: bert.id });
  });

  it("aktualisiert den Ansprechpartner", async () => {
    const res = await callTool("upsert_contact_person", { customer: customerName, id: contactId, firstName: "Anna", lastName: "Musterfrau" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/Musterfrau/);
  });

  it("meldet Validierungsfehler bei leerem Nachnamen", async () => {
    const res = await callTool("upsert_contact_person", { customer: customerName, firstName: "A", lastName: "" });
    expect(res.isError).toBe(true);
  });

  it("loescht den Ansprechpartner", async () => {
    const res = await callTool("delete_contact_person", { customer: customerName, id: contactId });
    expect(res.isError).toBeFalsy();
  });
});

describe("update_customer_defaults", () => {
  it("ersetzt die Kundenvorgaben vollstaendig", async () => {
    const res = await callTool("update_customer_defaults", { customer: customerName, defaultDiscountPermille: 50, eInvoicePreferred: true, language: "de" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/"defaultDiscountPermille":50/);
  });

  it("meldet ungueltige defaultCurrency als Fehler", async () => {
    const res = await callTool("update_customer_defaults", { customer: customerName, defaultCurrency: "eur" });
    expect(res.isError).toBe(true);
  });
});

describe("list_custom_fields / upsert_custom_field / set_customer_custom_fields", () => {
  let fieldId: string;

  it("legt eine Kundenfeld-Definition an", async () => {
    const res = await callTool("upsert_custom_field", { key: "vipmcp", label: "VIP (MCP)", type: "BOOLEAN", required: false });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_custom_fields")));
    const found = list.find((d: { key: string }) => d.key === "vipmcp");
    expect(found).toBeTruthy();
    fieldId = found.id;
  });

  it("meldet einen doppelten key als Fehler", async () => {
    const res = await callTool("upsert_custom_field", { key: "vipmcp", label: "Doppelt", type: "TEXT" });
    expect(res.isError).toBe(true);
  });

  it("aktualisiert die Definition (mit id)", async () => {
    const res = await callTool("upsert_custom_field", { id: fieldId, key: "vipmcp", label: "VIP (MCP, angepasst)", type: "BOOLEAN" });
    expect(res.isError).toBeFalsy();
  });

  it("setzt Kundenfeld-Werte fuer den Kunden", async () => {
    const res = await callTool("set_customer_custom_fields", { customer: customerName, values: { vipmcp: true } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/"vipmcp":true/);
  });

  it("lehnt einen unbekannten Key ab", async () => {
    const res = await callTool("set_customer_custom_fields", { customer: customerName, values: { unbekannt: "x" } });
    expect(res.isError).toBe(true);
  });

  it("reorder_custom_fields (Nit, Fix-Welle): setzt die Reihenfolge neu", async () => {
    const second = await callTool("upsert_custom_field", { key: "vipmcp2", label: "VIP 2 (MCP)", type: "TEXT" });
    expect(second.isError).toBeFalsy();
    const before = JSON.parse(text(await callTool("list_custom_fields")));
    const ids = before.map((d: { id: string }) => d.id) as string[];
    const reversed = [...ids].reverse();

    const res = await callTool("reorder_custom_fields", { ids: reversed });
    expect(res.isError).toBeFalsy();
    const after = JSON.parse(text(await callTool("list_custom_fields")));
    expect(after.map((d: { id: string }) => d.id)).toEqual(reversed);
  });

  it("reorder_custom_fields lehnt eine unvollstaendige ids-Liste ab", async () => {
    const res = await callTool("reorder_custom_fields", { ids: ["nur-eine-fantasie-id"] });
    expect(res.isError).toBe(true);
  });

  it("delete_custom_field (Nit, Fix-Welle): loescht die Definition, Werte bleiben im JSON stehen (§31)", async () => {
    const res = await callTool("delete_custom_field", { id: fieldId });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(text(await callTool("list_custom_fields")));
    expect(list.find((d: { id: string }) => d.id === fieldId)).toBeUndefined();

    // Wert des geloeschten Feldes bleibt im gespeicherten JSON stehen (kein Cleanup) —
    // customFieldsFor uebergeht ihn beim Lesen still statt ihn zu verwerfen.
    const customer = await dbInternal.customer.findFirstOrThrow({ where: { orgId, name: customerName } });
    expect(customer.customFieldsJson).toContain("vipmcp");
  });

  it("meldet eine unbekannte Definitions-ID beim Loeschen als Fehler", async () => {
    const res = await callTool("delete_custom_field", { id: "nicht-vorhanden" });
    expect(res.isError).toBe(true);
  });
});

describe("take_over_last_document", () => {
  function invoiceInput(customerId: string): CreateInvoiceInput {
    return {
      customerId,
      type: "INVOICE",
      taxScheme: "REGULAR",
      issueDate: ISSUE,
      deliveryDate: ISSUE,
      lines: [
        { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ],
      headerText: "MCP-Kopftext",
      footerText: "MCP-Fusstext",
      paymentTerms: "10 Tage netto.",
    } as CreateInvoiceInput;
  }

  it("meldet, wenn kein Beleg existiert", async () => {
    const other = await dbInternal.customer.create({
      data: { orgId, name: "Kunde ohne Beleg MCP", addressLine1: "X", postalCode: "1", city: "Y", type: "BUSINESS" },
    });
    const res = await callTool("take_over_last_document", { customer: other.name, kind: "INVOICE" });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/[Kk]ein/);
  });

  it("liefert Prefill des letzten festgeschriebenen Belegs", async () => {
    const customer = await dbInternal.customer.findFirstOrThrow({ where: { orgId, name: customerName } });
    const draft = await createDraftInvoice(orgId, invoiceInput(customer.id));
    await finalizeInvoice(draft.id, { now: ISSUE });

    const res = await callTool("take_over_last_document", { customer: customerName, kind: "INVOICE" });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(text(res));
    expect(parsed.prefill.headerText).toBe("MCP-Kopftext");
    expect(parsed.prefill.lines.length).toBe(1);
  });
});
