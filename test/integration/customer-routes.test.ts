/**
 * Phase 8a, Task 3 — Routen-Tests: Kunden-Adressen/-Ansprechpartner (CRUD + Default),
 * Kundenvorgaben, Kundenfeld-Definitionen (CRUD + Reorder), Kundenfeld-Werte,
 * letzter Beleg + Take-over-Prefill. Muster: test/integration/dunning-routes.test.ts
 * (Route-Handler direkt aufrufen, Auth/Org gemockt). Eigenes Jahr 2061 (Testjahr-
 * Konvention, plan-header.md).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "tester",
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import type { CreateInvoiceInput } from "@/schemas";

import { GET as addressesGet, POST as addressesPost } from "@/app/api/customers/[id]/addresses/route";
import { PATCH as addressPatch, DELETE as addressDelete } from "@/app/api/customers/[id]/addresses/[addressId]/route";
import { POST as addressDefaultPost } from "@/app/api/customers/[id]/addresses/[addressId]/default/route";
import { GET as contactsGet, POST as contactsPost } from "@/app/api/customers/[id]/contacts/route";
import { PATCH as contactPatch, DELETE as contactDelete } from "@/app/api/customers/[id]/contacts/[contactId]/route";
import { POST as contactDefaultPost } from "@/app/api/customers/[id]/contacts/[contactId]/default/route";
import { GET as defaultsGet, PUT as defaultsPut } from "@/app/api/customers/[id]/defaults/route";
import { PUT as customFieldValuesPut } from "@/app/api/customers/[id]/custom-fields/route";
import { GET as customFieldsGet, POST as customFieldsPost } from "@/app/api/custom-fields/route";
import { PATCH as customFieldPatch, DELETE as customFieldDelete } from "@/app/api/custom-fields/[id]/route";
import { POST as customFieldsReorderPost } from "@/app/api/custom-fields/reorder/route";
import { GET as lastDocumentGet } from "@/app/api/customers/[id]/last-document/route";
import { POST as takeOverPrefillPost } from "@/app/api/documents/[id]/take-over-prefill/route";

const ISSUE = new Date("2061-04-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function emptyRequest(url: string, method = "GET"): Request {
  return new Request(url, { method });
}
function ctx1(id: string) {
  return { params: Promise.resolve({ id }) };
}
function ctx2(id: string, key2: "addressId", id2: string): { params: Promise<{ id: string; addressId: string }> };
function ctx2(id: string, key2: "contactId", id2: string): { params: Promise<{ id: string; contactId: string }> };
function ctx2(id: string, key2: "addressId" | "contactId", id2: string) {
  return { params: Promise.resolve({ id, [key2]: id2 }) };
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Routen-Kunden GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
  // Invoice.number ist GLOBAL eindeutig — eigener Praefix fuer dieses Testjahr (2061).
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "RTV-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", ISSUE);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Routen-Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

describe("Kunden-Adressen (/api/customers/[id]/addresses)", () => {
  let addressId: string;

  it("GET liefert leere Liste zu Beginn", async () => {
    const res = await addressesGet(emptyRequest("http://x"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.addresses).toEqual([]);
  });

  it("POST 201: legt eine Adresse an", async () => {
    const res = await addressesPost(
      jsonRequest("http://x", { type: "BILLING", addressLine1: "Rechnungsweg 1", postalCode: "10115", city: "Berlin", isDefault: true }),
      ctx1(customerId),
    );
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(j.address.isDefault).toBe(true);
    addressId = j.address.id;
  });

  it("POST 400: Validierung fehlgeschlagen bei fehlender addressLine1", async () => {
    const res = await addressesPost(jsonRequest("http://x", { type: "BILLING", addressLine1: "", postalCode: "10115", city: "Berlin" }), ctx1(customerId));
    expect(res.status).toBe(400);
  });

  it("POST 404: unbekannter Kunde", async () => {
    const res = await addressesPost(jsonRequest("http://x", { type: "BILLING", addressLine1: "X", postalCode: "1", city: "Y" }), ctx1("unknown-customer"));
    expect(res.status).toBe(404);
  });

  it("PATCH 200: aktualisiert eine Adresse", async () => {
    const res = await addressPatch(
      jsonRequest("http://x", { type: "BILLING", addressLine1: "Neuer Weg 5", postalCode: "10117", city: "Berlin", isDefault: true }, "PATCH"),
      ctx2(customerId, "addressId", addressId),
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.address.addressLine1).toBe("Neuer Weg 5");
  });

  it("POST default: setzt eine zweite Adresse als Default und verdraengt die erste", async () => {
    const created = await addressesPost(
      jsonRequest("http://x", { type: "BILLING", addressLine1: "Zweitadresse 2", postalCode: "10119", city: "Berlin" }),
      ctx1(customerId),
    );
    const secondId = (await created.json()).address.id;
    const res = await addressDefaultPost(emptyRequest("http://x"), ctx2(customerId, "addressId", secondId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.address.isDefault).toBe(true);
    const list = await (await addressesGet(emptyRequest("http://x"), ctx1(customerId))).json();
    const first = list.addresses.find((a: { id: string }) => a.id === addressId);
    expect(first.isDefault).toBe(false);
  });

  it("DELETE 404: unbekannte Adresse", async () => {
    const res = await addressDelete(emptyRequest("http://x", "DELETE"), ctx2(customerId, "addressId", "unknown-address"));
    expect(res.status).toBe(404);
  });

  it("DELETE 200: loescht eine Adresse", async () => {
    const res = await addressDelete(emptyRequest("http://x", "DELETE"), ctx2(customerId, "addressId", addressId));
    expect(res.status).toBe(200);
  });
});

describe("Kunden-Ansprechpartner (/api/customers/[id]/contacts)", () => {
  let contactId: string;

  it("POST 201: legt einen Ansprechpartner an", async () => {
    const res = await contactsPost(jsonRequest("http://x", { firstName: "Anna", lastName: "Muster", isDefault: true }), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(j.contact.isDefault).toBe(true);
    contactId = j.contact.id;
  });

  it("GET liefert den angelegten Ansprechpartner", async () => {
    const res = await contactsGet(emptyRequest("http://x"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.contacts.length).toBe(1);
  });

  it("POST 400: Validierung fehlgeschlagen bei fehlendem Nachnamen", async () => {
    const res = await contactsPost(jsonRequest("http://x", { firstName: "Anna", lastName: "" }), ctx1(customerId));
    expect(res.status).toBe(400);
  });

  it("PATCH 200: aktualisiert einen Ansprechpartner", async () => {
    const res = await contactPatch(jsonRequest("http://x", { firstName: "Anna", lastName: "Musterfrau" }, "PATCH"), ctx2(customerId, "contactId", contactId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.contact.lastName).toBe("Musterfrau");
  });

  it("POST default: setzt Default erneut (idempotent)", async () => {
    const res = await contactDefaultPost(emptyRequest("http://x"), ctx2(customerId, "contactId", contactId));
    expect(res.status).toBe(200);
  });

  it("PATCH 404: unbekannter Ansprechpartner", async () => {
    const res = await contactPatch(jsonRequest("http://x", { firstName: "A", lastName: "B" }, "PATCH"), ctx2(customerId, "contactId", "unknown"));
    expect(res.status).toBe(404);
  });

  it("DELETE 200: loescht einen Ansprechpartner", async () => {
    const res = await contactDelete(emptyRequest("http://x", "DELETE"), ctx2(customerId, "contactId", contactId));
    expect(res.status).toBe(200);
  });
});

describe("Kundenvorgaben (/api/customers/[id]/defaults)", () => {
  it("GET liefert den Ausgangszustand", async () => {
    const res = await defaultsGet(emptyRequest("http://x"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.defaults.defaultDiscountPermille).toBe(0);
  });

  it("PUT 200: speichert die Kundenvorgaben (Vollersatz)", async () => {
    const res = await defaultsPut(jsonRequest("http://x", { defaultDiscountPermille: 50, language: "de", eInvoicePreferred: true }, "PUT"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.defaults.defaultDiscountPermille).toBe(50);
    expect(j.defaults.eInvoicePreferred).toBe(true);
  });

  it("PUT 400: ungueltige defaultCurrency", async () => {
    const res = await defaultsPut(jsonRequest("http://x", { defaultCurrency: "eur" }, "PUT"), ctx1(customerId));
    expect(res.status).toBe(400);
  });

  it("PUT 404: unbekannter Kunde", async () => {
    const res = await defaultsPut(jsonRequest("http://x", {}, "PUT"), ctx1("unknown"));
    expect(res.status).toBe(404);
  });
});

describe("Kundenfeld-Definitionen (/api/custom-fields)", () => {
  let fieldId: string;
  let secondFieldId: string;

  it("POST 201: legt eine Definition an", async () => {
    const res = await customFieldsPost(jsonRequest("http://x", { key: "vip", label: "VIP-Kunde", type: "BOOLEAN", required: false, sortOrder: 0, isActive: true }));
    const j = await res.json();
    expect(res.status).toBe(201);
    fieldId = j.definition.id;
  });

  it("POST 409: doppelter key in derselben Org", async () => {
    const res = await customFieldsPost(jsonRequest("http://x", { key: "vip", label: "Doppelt", type: "TEXT" }));
    expect(res.status).toBe(409);
  });

  it("GET listet Definitionen", async () => {
    const res = await customFieldsGet();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.definitions.length).toBeGreaterThanOrEqual(1);
  });

  it("POST zweite Definition fuer Reorder-Test", async () => {
    const res = await customFieldsPost(jsonRequest("http://x", { key: "branche", label: "Branche", type: "TEXT", sortOrder: 1 }));
    const j = await res.json();
    secondFieldId = j.definition.id;
  });

  it("PATCH 200: aktualisiert eine Definition", async () => {
    const res = await customFieldPatch(jsonRequest("http://x", { key: "vip", label: "VIP-Kunde (angepasst)", type: "BOOLEAN" }, "PATCH"), ctx1(fieldId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.definition.label).toBe("VIP-Kunde (angepasst)");
  });

  it("POST reorder: vertauscht die Reihenfolge", async () => {
    const res = await customFieldsReorderPost(jsonRequest("http://x", { ids: [secondFieldId, fieldId] }));
    expect(res.status).toBe(200);
    const list = await (await customFieldsGet()).json();
    expect(list.definitions[0].id).toBe(secondFieldId);
  });

  it("POST reorder 409: unvollstaendige Id-Liste", async () => {
    const res = await customFieldsReorderPost(jsonRequest("http://x", { ids: [fieldId] }));
    expect(res.status).toBe(409);
  });

  it("PUT /customers/[id]/custom-fields: setzt Werte fuer den Kunden", async () => {
    const res = await customFieldValuesPut(jsonRequest("http://x", { vip: true, branche: "IT" }, "PUT"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.customFields.vip).toBe(true);
    expect(j.customFields.branche).toBe("IT");
  });

  it("PUT /customers/[id]/custom-fields: 400 bei unbekanntem Key", async () => {
    const res = await customFieldValuesPut(jsonRequest("http://x", { unbekannterKey: "x" }, "PUT"), ctx1(customerId));
    expect(res.status).toBe(400);
  });

  it("DELETE 200: loescht eine Definition (Werte bleiben im JSON)", async () => {
    const res = await customFieldDelete(emptyRequest("http://x", "DELETE"), ctx1(secondFieldId));
    expect(res.status).toBe(200);
  });

  it("PATCH 404: unbekannte Definition", async () => {
    const res = await customFieldPatch(jsonRequest("http://x", { key: "xx", label: "x", type: "TEXT" }, "PATCH"), ctx1("unknown"));
    expect(res.status).toBe(404);
  });
});

describe("Letzter Beleg + Take-over-Prefill", () => {
  let invoiceId: string;

  function invoiceInput(): CreateInvoiceInput {
    return {
      customerId,
      type: "INVOICE",
      taxScheme: "REGULAR",
      issueDate: ISSUE,
      deliveryDate: ISSUE,
      lines: [
        { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ],
      headerText: "Kopftext",
      footerText: "Fusstext",
      paymentTerms: "10 Tage netto.",
    } as CreateInvoiceInput;
  }

  it("GET last-document: null wenn noch kein festgeschriebener Beleg existiert", async () => {
    const res = await lastDocumentGet(new Request("http://x?kind=INVOICE"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.document).toBeNull();
  });

  it("GET last-document 400: unbekannter kind-Wert", async () => {
    const res = await lastDocumentGet(new Request("http://x?kind=UNBEKANNT"), ctx1(customerId));
    expect(res.status).toBe(400);
  });

  it("GET last-document: findet den festgeschriebenen Beleg", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const fin = await finalizeInvoice(draft.id, { now: ISSUE });
    invoiceId = fin.id;
    const res = await lastDocumentGet(new Request("http://x?kind=INVOICE"), ctx1(customerId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.document.id).toBe(invoiceId);
  });

  it("POST take-over-prefill: liefert Positionen/Texte/Konditionen", async () => {
    const res = await takeOverPrefillPost(jsonRequest("http://x", { lines: true, texts: true, terms: true, prices: true }), ctx1(invoiceId));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.prefill.lines.length).toBe(1);
    expect(j.prefill.headerText).toBe("Kopftext");
  });

  it("POST take-over-prefill 404: unbekannter Beleg", async () => {
    const res = await takeOverPrefillPost(jsonRequest("http://x", {}), ctx1("unknown-doc"));
    expect(res.status).toBe(404);
  });
});
