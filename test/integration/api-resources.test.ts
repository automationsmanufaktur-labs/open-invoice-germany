/**
 * Phase 10, Task 2 — Ressourcen-Endpunkte (task-2-brief.md, task-2-facts.md). Testjahr
 * 2074 (plan-header.md), eigener NumberRange-Praefix ist hier NICHT noetig: Rechnungen
 * werden fuer den "409 bei festgeschrieben"-Test nie ueber `finalizeInvoice` (das echte
 * Nummernkreise braucht), sondern per direktem `dbInternal.invoice.update({status:
 * "FINALIZED", number: "TEST-<id>"})` in den Zustand versetzt (Muster aus
 * test/integration/invoice-route.test.ts) — `TEST-<id>` ist ueber die cuid immer
 * eindeutig, also kollisionsfrei mit anderen Testdateien desselben Jahres.
 *
 * Muster fuer Route-Aufrufe: test/integration/api-auth.test.ts (echte API-Keys ueber
 * createApiKey, Route-Handler direkt aufgerufen statt echtem HTTP-Server).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createApiKey } from "@/domain/api-key/create";
import { resetRateLimits } from "@/lib/rate-limit";
import { recordPayment } from "@/domain/invoice/payment";
import { createDunning } from "@/domain/dunning/create";
import { NotFoundError } from "@/domain/errors";

import { GET as ContactList, POST as ContactCreate } from "@/app/api/v1/Contact/route";
import { GET as ContactGet, PATCH as ContactUpdate } from "@/app/api/v1/Contact/[id]/route";
import { GET as ContactAddressList, POST as ContactAddressCreate } from "@/app/api/v1/ContactAddress/route";
import { GET as ContactAddressGet, PATCH as ContactAddressUpdate } from "@/app/api/v1/ContactAddress/[id]/route";
import { GET as ContactPersonList, POST as ContactPersonCreate } from "@/app/api/v1/ContactPerson/route";
import { GET as ContactPersonGet } from "@/app/api/v1/ContactPerson/[id]/route";
import { GET as ProductList, POST as ProductCreate } from "@/app/api/v1/Product/route";
import { GET as ProductGet, PATCH as ProductUpdate } from "@/app/api/v1/Product/[id]/route";
import { GET as QuoteList, POST as QuoteCreate } from "@/app/api/v1/Quote/route";
import { GET as QuoteGet, PATCH as QuoteUpdate } from "@/app/api/v1/Quote/[id]/route";
import { GET as OrderConfirmationList, POST as OrderConfirmationCreate } from "@/app/api/v1/OrderConfirmation/route";
import { GET as OrderConfirmationGet } from "@/app/api/v1/OrderConfirmation/[id]/route";
import { GET as DeliveryNoteList, POST as DeliveryNoteCreate } from "@/app/api/v1/DeliveryNote/route";
import { GET as DeliveryNoteGet } from "@/app/api/v1/DeliveryNote/[id]/route";
import { GET as InvoiceList, POST as InvoiceCreate } from "@/app/api/v1/Invoice/route";
import { GET as InvoiceGet, PATCH as InvoiceUpdate } from "@/app/api/v1/Invoice/[id]/route";
import { GET as PaymentList, POST as PaymentCreate } from "@/app/api/v1/Payment/route";
import { GET as PaymentGet } from "@/app/api/v1/Payment/[id]/route";
import { GET as DunningList, POST as DunningCreate } from "@/app/api/v1/Dunning/route";
import { GET as DunningGet } from "@/app/api/v1/Dunning/[id]/route";
import { GET as AttachmentList, POST as AttachmentCreate } from "@/app/api/v1/Attachment/route";
import { GET as AttachmentGet } from "@/app/api/v1/Attachment/[id]/route";
import { GET as EmailLogList } from "@/app/api/v1/EmailLog/route";
import { GET as EmailLogGet } from "@/app/api/v1/EmailLog/[id]/route";
import { GET as PaymentMethodList, POST as PaymentMethodCreate } from "@/app/api/v1/PaymentMethod/route";
import { GET as PaymentMethodGet, PATCH as PaymentMethodUpdate } from "@/app/api/v1/PaymentMethod/[id]/route";
import { GET as TextTemplateList, POST as TextTemplateCreate } from "@/app/api/v1/TextTemplate/route";
import { GET as TextTemplateGet, PATCH as TextTemplateUpdate } from "@/app/api/v1/TextTemplate/[id]/route";
import { GET as EmailTemplateList, POST as EmailTemplateCreate } from "@/app/api/v1/EmailTemplate/route";
import { GET as EmailTemplateGet, PATCH as EmailTemplateUpdate } from "@/app/api/v1/EmailTemplate/[id]/route";
import { GET as SettingsGet, PATCH as SettingsUpdate } from "@/app/api/v1/Settings/route";
import { GET as ApiKeyList, POST as ApiKeyCreate } from "@/app/api/v1/ApiKey/route";
import { GET as ApiKeyGet, PATCH as ApiKeyUpdate } from "@/app/api/v1/ApiKey/[id]/route";

let orgId: string;
let otherOrgId: string;
let customerId: string;
let otherCustomerId: string;
let token: string;
let otherToken: string;

function req(url: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function json(res: Response) {
  return res.json();
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "API-Resources Test GmbH", addressLine1: "Teststr. 2", postalCode: "10117", city: "Berlin", vatId: "DE222222222", taxNumber: "22/222/22222" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);

  const other = await dbInternal.organization.create({
    data: { legalName: "Fremde Organisation GmbH", addressLine1: "X-Str. 1", postalCode: "1", city: "X" },
  });
  otherOrgId = other.id;
  await ensureOrgMasterdata(dbInternal, otherOrgId);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Testkunde AG", addressLine1: "Marktplatz 3", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;

  const otherCustomer = await dbInternal.customer.create({
    data: { orgId: otherOrgId, name: "Fremdkunde AG", addressLine1: "X", postalCode: "1", city: "X", type: "BUSINESS" },
  });
  otherCustomerId = otherCustomer.id;

  const key = await createApiKey(orgId, { name: "Resources-Key", scopes: ["read", "write", "admin"] });
  token = key.token;
  const otherKey = await createApiKey(otherOrgId, { name: "Other-Key", scopes: ["read", "write", "admin"] });
  otherToken = otherKey.token;
  resetRateLimits();
});

// ── Contact (=Customer) ──────────────────────────────────────────────────────
describe("/api/v1/Contact", () => {
  it("Liste: Paginierung/Suche", async () => {
    const res = await ContactList(req(`http://x/api/v1/Contact?limit=1&offset=0`, { token }));
    expect(res.status).toBe(200);
    const j = await json(res);
    expect(j.limit).toBe(1);
    expect(j.total).toBeGreaterThanOrEqual(1);
    expect(j.data[0].objectName).toBe("Contact");
  });

  it("Create -> 201, dann Get", async () => {
    const res = await ContactCreate(req("http://x/api/v1/Contact", { method: "POST", token, body: { name: "Neuer Kunde", addressLine1: "A", postalCode: "1", city: "B" } }));
    expect(res.status).toBe(201);
    const created = (await json(res)).data;
    expect(created.customerNumber).toBeTruthy();
    const getRes = await ContactGet(req(`http://x/api/v1/Contact/${created.id}`, { token }), ctxFor(created.id));
    expect(getRes.status).toBe(200);
  });

  it("Create mit fehlendem Pflichtfeld -> 400 VALIDATION", async () => {
    const res = await ContactCreate(req("http://x/api/v1/Contact", { method: "POST", token, body: { addressLine1: "A" } }));
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("VALIDATION");
  });

  it("Update -> 200", async () => {
    const res = await ContactUpdate(req(`http://x/api/v1/Contact/${customerId}`, { method: "PATCH", token, body: { notes: "aktualisiert" } }), ctxFor(customerId));
    expect(res.status).toBe(200);
    expect((await json(res)).data.notes).toBe("aktualisiert");
  });

  it("Get fremder Org -> 404", async () => {
    const res = await ContactGet(req(`http://x/api/v1/Contact/${otherCustomerId}`, { token }), ctxFor(otherCustomerId));
    expect(res.status).toBe(404);
  });
});

// ── ContactAddress / ContactPerson ───────────────────────────────────────────
describe("/api/v1/ContactAddress + ContactPerson", () => {
  it("ContactAddress: Create, Liste (contactId), Get, Update", async () => {
    const createRes = await ContactAddressCreate(
      req("http://x/api/v1/ContactAddress", { method: "POST", token, body: { contactId: customerId, type: "SHIPPING", addressLine1: "Lager 1", postalCode: "1", city: "X" } }),
    );
    expect(createRes.status).toBe(201);
    const addr = (await json(createRes)).data;
    const listRes = await ContactAddressList(req(`http://x/api/v1/ContactAddress?contactId=${customerId}`, { token }));
    expect(listRes.status).toBe(200);
    expect((await json(listRes)).data.length).toBeGreaterThanOrEqual(1);
    const getRes = await ContactAddressGet(req(`http://x/api/v1/ContactAddress/${addr.id}`, { token }), ctxFor(addr.id));
    expect(getRes.status).toBe(200);
    const updRes = await ContactAddressUpdate(
      req(`http://x/api/v1/ContactAddress/${addr.id}`, { method: "PATCH", token, body: { type: "SHIPPING", addressLine1: "Lager 2", postalCode: "1", city: "X" } }),
      ctxFor(addr.id),
    );
    expect(updRes.status).toBe(200);
    expect((await json(updRes)).data.addressLine1).toBe("Lager 2");
  });

  it("ContactAddress Liste ohne contactId -> 400", async () => {
    const res = await ContactAddressList(req("http://x/api/v1/ContactAddress", { token }));
    expect(res.status).toBe(400);
  });

  it("ContactPerson: Create, Liste, Get", async () => {
    const createRes = await ContactPersonCreate(
      req("http://x/api/v1/ContactPerson", { method: "POST", token, body: { contactId: customerId, firstName: "Erika", lastName: "Muster" } }),
    );
    expect(createRes.status).toBe(201);
    const person = (await json(createRes)).data;
    const listRes = await ContactPersonList(req(`http://x/api/v1/ContactPerson?contactId=${customerId}`, { token }));
    expect(listRes.status).toBe(200);
    const getRes = await ContactPersonGet(req(`http://x/api/v1/ContactPerson/${person.id}`, { token }), ctxFor(person.id));
    expect(getRes.status).toBe(200);
  });
});

// ── Product ───────────────────────────────────────────────────────────────
describe("/api/v1/Product", () => {
  let productId: string;

  it("Create -> 201", async () => {
    const res = await ProductCreate(req("http://x/api/v1/Product", { method: "POST", token, body: { name: "Beratung", netPriceCents: 10000, taxRate: 19 } }));
    expect(res.status).toBe(201);
    productId = (await json(res)).data.id;
  });

  it("Liste: Paginierung/Suche", async () => {
    const res = await ProductList(req("http://x/api/v1/Product?search=Beratung", { token }));
    expect(res.status).toBe(200);
    expect((await json(res)).data.length).toBeGreaterThanOrEqual(1);
  });

  it("Get", async () => {
    const res = await ProductGet(req(`http://x/api/v1/Product/${productId}`, { token }), ctxFor(productId));
    expect(res.status).toBe(200);
  });

  it("Create ohne name -> 400", async () => {
    const res = await ProductCreate(req("http://x/api/v1/Product", { method: "POST", token, body: { netPriceCents: 100 } }));
    expect(res.status).toBe(400);
  });

  it("Update", async () => {
    const res = await ProductUpdate(req(`http://x/api/v1/Product/${productId}`, { method: "PATCH", token, body: { netPriceCents: 12000 } }), ctxFor(productId));
    expect(res.status).toBe(200);
    expect((await json(res)).data.netPriceCents).toBe(12000);
  });

  it("Get fremder Org -> 404", async () => {
    const res = await ProductGet(req(`http://x/api/v1/Product/${productId}`, { token: otherToken }), ctxFor(productId));
    expect(res.status).toBe(404);
  });
});

// ── Quote / OrderConfirmation ────────────────────────────────────────────────
async function createQuote(kindHandler: typeof QuoteCreate, url: string) {
  const res = await kindHandler(
    req(url, { method: "POST", token, body: { customerId, lines: [{ description: "Pos 1", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] } }),
  );
  expect(res.status).toBe(201);
  return (await json(res)).data;
}

describe("/api/v1/Quote", () => {
  it("Create -> objectName Quote, kind ANGEBOT erzwungen", async () => {
    const created = await createQuote(QuoteCreate, "http://x/api/v1/Quote");
    expect(created.objectName).toBe("Quote");
    expect(created.kind).toBe("ANGEBOT");
  });

  it("Liste: Paginierung/Filter/embed=lines", async () => {
    const res = await QuoteList(req("http://x/api/v1/Quote?limit=5&embed=lines", { token }));
    expect(res.status).toBe(200);
    const j = await json(res);
    expect(j.limit).toBe(5);
    expect(j.data[0].lines).toBeDefined();
  });

  it("Get + embed=customer", async () => {
    const created = await createQuote(QuoteCreate, "http://x/api/v1/Quote");
    const res = await QuoteGet(req(`http://x/api/v1/Quote/${created.id}?embed=customer`, { token }), ctxFor(created.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.customerName).toBe("Testkunde AG");
  });

  it("Create ohne lines -> 400", async () => {
    const res = await QuoteCreate(req("http://x/api/v1/Quote", { method: "POST", token, body: { customerId } }));
    expect(res.status).toBe(400);
  });

  it("Update eines nicht-DRAFT-Angebots -> 409 CONFLICT", async () => {
    const created = await createQuote(QuoteCreate, "http://x/api/v1/Quote");
    await dbInternal.quote.update({ where: { id: created.id }, data: { status: "SENT" } });
    const res = await QuoteUpdate(req(`http://x/api/v1/Quote/${created.id}`, { method: "PATCH", token, body: { subject: "x" } }), ctxFor(created.id));
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("CONFLICT");
  });

  it("Get fremder Org -> 404", async () => {
    const created = await createQuote(QuoteCreate, "http://x/api/v1/Quote");
    const res = await QuoteGet(req(`http://x/api/v1/Quote/${created.id}`, { token: otherToken }), ctxFor(created.id));
    expect(res.status).toBe(404);
  });
});

describe("/api/v1/OrderConfirmation", () => {
  it("Create -> objectName OrderConfirmation, kind AUFTRAGSBESTAETIGUNG erzwungen", async () => {
    const created = await createQuote(OrderConfirmationCreate, "http://x/api/v1/OrderConfirmation");
    expect(created.objectName).toBe("OrderConfirmation");
    expect(created.kind).toBe("AUFTRAGSBESTAETIGUNG");
  });

  it("ANGEBOT-Quote taucht NICHT in der OrderConfirmation-Liste auf", async () => {
    const quote = await createQuote(QuoteCreate, "http://x/api/v1/Quote");
    const res = await OrderConfirmationGet(req(`http://x/api/v1/OrderConfirmation/${quote.id}`, { token }), ctxFor(quote.id));
    expect(res.status).toBe(404);
  });

  it("Liste", async () => {
    const res = await OrderConfirmationList(req("http://x/api/v1/OrderConfirmation", { token }));
    expect(res.status).toBe(200);
  });
});

// ── DeliveryNote ─────────────────────────────────────────────────────────────
describe("/api/v1/DeliveryNote", () => {
  it("Create -> 201, Liste, Get", async () => {
    const res = await DeliveryNoteCreate(
      req("http://x/api/v1/DeliveryNote", { method: "POST", token, body: { customerId, lines: [{ description: "Paket", quantityMilli: 1000 }] } }),
    );
    expect(res.status).toBe(201);
    const created = (await json(res)).data;
    expect(created.objectName).toBe("DeliveryNote");

    const listRes = await DeliveryNoteList(req("http://x/api/v1/DeliveryNote?limit=10", { token }));
    expect(listRes.status).toBe(200);

    const getRes = await DeliveryNoteGet(req(`http://x/api/v1/DeliveryNote/${created.id}?embed=lines`, { token }), ctxFor(created.id));
    expect(getRes.status).toBe(200);
    expect((await json(getRes)).data.lines.length).toBe(1);
  });

  it("Create ohne lines -> 400", async () => {
    const res = await DeliveryNoteCreate(req("http://x/api/v1/DeliveryNote", { method: "POST", token, body: { customerId, lines: [] } }));
    expect(res.status).toBe(400);
  });

  it("Get fremder Org -> 404", async () => {
    const res = await DeliveryNoteGet(req(`http://x/api/v1/DeliveryNote/nonexistent`, { token }), ctxFor("nonexistent"));
    expect(res.status).toBe(404);
  });
});

// ── Invoice ──────────────────────────────────────────────────────────────────
async function createInvoice() {
  const res = await InvoiceCreate(
    req("http://x/api/v1/Invoice", { method: "POST", token, body: { customerId, lines: [{ description: "Pos 1", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }] } }),
  );
  expect(res.status).toBe(201);
  return (await json(res)).data;
}

describe("/api/v1/Invoice", () => {
  it("Create -> 201 DRAFT", async () => {
    const created = await createInvoice();
    expect(created.objectName).toBe("Invoice");
    expect(created.status).toBe("DRAFT");
  });

  it("Liste: Paginierung/Filter/embed=customer,lines,payments", async () => {
    const res = await InvoiceList(req("http://x/api/v1/Invoice?limit=5&status=all&embed=customer,lines,payments", { token }));
    expect(res.status).toBe(200);
    const j = await json(res);
    expect(j.data[0].customerName).toBeDefined();
    expect(j.data[0].lines).toBeDefined();
    expect(j.data[0].payments).toBeDefined();
  });

  it("Get", async () => {
    const created = await createInvoice();
    const res = await InvoiceGet(req(`http://x/api/v1/Invoice/${created.id}`, { token }), ctxFor(created.id));
    expect(res.status).toBe(200);
  });

  it("Create mit ungueltiger taxRate -> 400", async () => {
    const res = await InvoiceCreate(
      req("http://x/api/v1/Invoice", { method: "POST", token, body: { customerId, lines: [{ description: "x", quantityMilli: 1000, unitNetPriceCents: 100, taxRate: 5 }] } }),
    );
    expect(res.status).toBe(400);
  });

  it("Update einer festgeschriebenen Rechnung -> 409 CONFLICT", async () => {
    const created = await createInvoice();
    await dbInternal.invoice.update({ where: { id: created.id }, data: { status: "FINALIZED", number: `TEST-${created.id}` } });
    const res = await InvoiceUpdate(req(`http://x/api/v1/Invoice/${created.id}`, { method: "PATCH", token, body: { subject: "x" } }), ctxFor(created.id));
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("CONFLICT");
  });

  it("Get fremder Org -> 404", async () => {
    const created = await createInvoice();
    const res = await InvoiceGet(req(`http://x/api/v1/Invoice/${created.id}`, { token: otherToken }), ctxFor(created.id));
    expect(res.status).toBe(404);
  });
});

// ── Payment ──────────────────────────────────────────────────────────────────
describe("/api/v1/Payment", () => {
  it("Create -> 201 (nach Festschreiben), Liste, Get", async () => {
    const created = await createInvoice();
    await dbInternal.invoice.update({ where: { id: created.id }, data: { status: "FINALIZED", number: `TEST-PAY-${created.id}` } });
    const res = await PaymentCreate(req("http://x/api/v1/Payment", { method: "POST", token, body: { invoiceId: created.id, amountCents: 1000 } }));
    expect(res.status).toBe(201);
    const payment = (await json(res)).data;
    const listRes = await PaymentList(req(`http://x/api/v1/Payment?invoiceId=${created.id}`, { token }));
    expect(listRes.status).toBe(200);
    expect((await json(listRes)).data.length).toBe(1);
    const getRes = await PaymentGet(req(`http://x/api/v1/Payment/${payment.id}`, { token }), ctxFor(payment.id));
    expect(getRes.status).toBe(200);
  });

  it("Create auf DRAFT-Rechnung -> 409 CONFLICT (PaymentError)", async () => {
    const created = await createInvoice();
    const res = await PaymentCreate(req("http://x/api/v1/Payment", { method: "POST", token, body: { invoiceId: created.id, amountCents: 100 } }));
    expect(res.status).toBe(409);
  });

  it("Create fuer fremde invoiceId -> 404", async () => {
    const created = await createInvoice();
    await dbInternal.invoice.update({ where: { id: created.id }, data: { status: "FINALIZED", number: `TEST-PAY2-${created.id}` } });
    const res = await PaymentCreate(req("http://x/api/v1/Payment", { method: "POST", token: otherToken, body: { invoiceId: created.id, amountCents: 100 } }));
    expect(res.status).toBe(404);
  });

  it("Fix-Runde 1 (Koordinator-Ruling b): recordPayment(orgId) wirft direkt NotFoundError fuer fremde invoiceId", async () => {
    const created = await createInvoice();
    await dbInternal.invoice.update({ where: { id: created.id }, data: { status: "FINALIZED", number: `TEST-PAY3-${created.id}` } });
    await expect(recordPayment(created.id, { amountCents: 100, method: "TRANSFER", isSkonto: false, applySkonto: false }, { orgId: otherOrgId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // ohne orgId (kein Organisationskontext) bleibt der Aufruf unveraendert erlaubt.
    await expect(
      recordPayment(created.id, { amountCents: 100, method: "TRANSFER", isSkonto: false, applySkonto: false }, {}),
    ).resolves.toBeDefined();
  });
});

// ── Dunning ──────────────────────────────────────────────────────────────────
describe("/api/v1/Dunning", () => {
  it("Liste + Get 404 fuer unbekannte ID", async () => {
    const res = await DunningList(req("http://x/api/v1/Dunning", { token }));
    expect(res.status).toBe(200);
    const getRes = await DunningGet(req("http://x/api/v1/Dunning/unknown", { token }), ctxFor("unknown"));
    expect(getRes.status).toBe(404);
  });

  it("Create fuer fremde invoiceId -> 404", async () => {
    const created = await createInvoice();
    const res = await DunningCreate(req("http://x/api/v1/Dunning", { method: "POST", token: otherToken, body: { invoiceId: created.id } }));
    expect(res.status).toBe(404);
  });

  it("Fix-Runde 1 (Koordinator-Ruling b): createDunning(orgId) wirft direkt NotFoundError fuer fremde invoiceId", async () => {
    const created = await createInvoice();
    await expect(createDunning(created.id, { orgId: otherOrgId })).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ── Attachment ───────────────────────────────────────────────────────────────
describe("/api/v1/Attachment", () => {
  it("Create (Base64) -> 201, Liste, Get", async () => {
    const created = await createInvoice();
    const contentBase64 = Buffer.from("hallo welt").toString("base64");
    const res = await AttachmentCreate(
      req("http://x/api/v1/Attachment", { method: "POST", token, body: { docType: "INVOICE", docId: created.id, filename: "test.txt", mime: "text/plain", contentBase64 } }),
    );
    expect(res.status).toBe(201);
    const att = (await json(res)).data;
    const listRes = await AttachmentList(req(`http://x/api/v1/Attachment?docType=INVOICE&docId=${created.id}`, { token }));
    expect(listRes.status).toBe(200);
    expect((await json(listRes)).data.length).toBe(1);
    const getRes = await AttachmentGet(req(`http://x/api/v1/Attachment/${att.id}`, { token }), ctxFor(att.id));
    expect(getRes.status).toBe(200);
  });

  it("Create fuer unbekannten Beleg -> 404", async () => {
    const contentBase64 = Buffer.from("x").toString("base64");
    const res = await AttachmentCreate(
      req("http://x/api/v1/Attachment", { method: "POST", token, body: { docType: "INVOICE", docId: "unknown", filename: "a.txt", mime: "text/plain", contentBase64 } }),
    );
    expect(res.status).toBe(404);
  });

  // Fix-Welle (Should-fix 5): Base64-Laenge MUSS vor dem Decode geprueft werden — sonst
  // alloziiert `Buffer.from(v.contentBase64, "base64")` bereits den vollen dekodierten
  // Puffer, bevor storeFile() die Dateigroesse (10 MB) ablehnt. Ueber 10 MB Rohdaten (hier
  // etwas mehr als das erlaubte Base64-Aequivalent), aber unter dem 16-MB-Body-Limit der
  // Route -> 413, nicht 400/500.
  it("Base64-Anhang ueber dem Dateilimit -> 413 PAYLOAD_TOO_LARGE (Body bleibt unter dem 16-MB-Routenlimit)", async () => {
    const created = await createInvoice();
    const contentBase64 = "A".repeat(14_000_000);
    const res = await AttachmentCreate(
      req("http://x/api/v1/Attachment", { method: "POST", token, body: { docType: "INVOICE", docId: created.id, filename: "big.txt", mime: "text/plain", contentBase64 } }),
    );
    expect(res.status).toBe(413);
    const j = await json(res);
    expect(j.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

// ── EmailLog (nur GET, siehe route.ts-Kommentar) ─────────────────────────────
describe("/api/v1/EmailLog", () => {
  it("Liste + Get 404", async () => {
    const res = await EmailLogList(req("http://x/api/v1/EmailLog", { token }));
    expect(res.status).toBe(200);
    const getRes = await EmailLogGet(req("http://x/api/v1/EmailLog/unknown", { token }), ctxFor("unknown"));
    expect(getRes.status).toBe(404);
  });
});

// ── PaymentMethod ─────────────────────────────────────────────────────────────
describe("/api/v1/PaymentMethod", () => {
  let methodId: string;

  it("Liste liefert Systemzahlungsmethoden", async () => {
    const res = await PaymentMethodList(req("http://x/api/v1/PaymentMethod", { token }));
    expect(res.status).toBe(200);
    expect((await json(res)).data.length).toBeGreaterThan(0);
  });

  it("Create -> 201", async () => {
    const res = await PaymentMethodCreate(req("http://x/api/v1/PaymentMethod", { method: "POST", token, body: { code: "CUSTOM1", name: "Eigene Methode" } }));
    expect(res.status).toBe(201);
    methodId = (await json(res)).data.id;
  });

  it("Create mit doppeltem code -> 409 CONFLICT", async () => {
    const res = await PaymentMethodCreate(req("http://x/api/v1/PaymentMethod", { method: "POST", token, body: { code: "CUSTOM1", name: "Duplikat" } }));
    expect(res.status).toBe(409);
  });

  it("Get + Update", async () => {
    const getRes = await PaymentMethodGet(req(`http://x/api/v1/PaymentMethod/${methodId}`, { token }), ctxFor(methodId));
    expect(getRes.status).toBe(200);
    const updRes = await PaymentMethodUpdate(req(`http://x/api/v1/PaymentMethod/${methodId}`, { method: "PATCH", token, body: { code: "CUSTOM1", name: "Umbenannt" } }), ctxFor(methodId));
    expect(updRes.status).toBe(200);
    expect((await json(updRes)).data.name).toBe("Umbenannt");
  });

  it("Get fremder Org -> 404", async () => {
    const res = await PaymentMethodGet(req(`http://x/api/v1/PaymentMethod/${methodId}`, { token: otherToken }), ctxFor(methodId));
    expect(res.status).toBe(404);
  });
});

// ── TextTemplate ──────────────────────────────────────────────────────────────
describe("/api/v1/TextTemplate", () => {
  let templateId: string;

  it("Liste liefert Standardvorlagen", async () => {
    const res = await TextTemplateList(req("http://x/api/v1/TextTemplate", { token }));
    expect(res.status).toBe(200);
    expect((await json(res)).data.length).toBeGreaterThan(0);
  });

  it("Create -> 201", async () => {
    const res = await TextTemplateCreate(req("http://x/api/v1/TextTemplate", { method: "POST", token, body: { name: "Eigene Vorlage", docType: "INVOICE", position: "FOOT", body: "Text" } }));
    expect(res.status).toBe(201);
    templateId = (await json(res)).data.id;
  });

  it("Create ohne body -> 400", async () => {
    const res = await TextTemplateCreate(req("http://x/api/v1/TextTemplate", { method: "POST", token, body: { name: "x", docType: "INVOICE", position: "FOOT" } }));
    expect(res.status).toBe(400);
  });

  it("Get + Update", async () => {
    const getRes = await TextTemplateGet(req(`http://x/api/v1/TextTemplate/${templateId}`, { token }), ctxFor(templateId));
    expect(getRes.status).toBe(200);
    const updRes = await TextTemplateUpdate(
      req(`http://x/api/v1/TextTemplate/${templateId}`, { method: "PATCH", token, body: { name: "Eigene Vorlage", docType: "INVOICE", position: "FOOT", body: "Neuer Text" } }),
      ctxFor(templateId),
    );
    expect(updRes.status).toBe(200);
  });

  it("Get fremder Org -> 404", async () => {
    const res = await TextTemplateGet(req(`http://x/api/v1/TextTemplate/${templateId}`, { token: otherToken }), ctxFor(templateId));
    expect(res.status).toBe(404);
  });
});

// ── EmailTemplate ─────────────────────────────────────────────────────────────
describe("/api/v1/EmailTemplate", () => {
  let templateId: string;

  it("Liste liefert Standardvorlagen", async () => {
    const res = await EmailTemplateList(req("http://x/api/v1/EmailTemplate", { token }));
    expect(res.status).toBe(200);
    expect((await json(res)).data.length).toBeGreaterThan(0);
  });

  it("Create -> 201, Get, Update", async () => {
    const res = await EmailTemplateCreate(
      req("http://x/api/v1/EmailTemplate", { method: "POST", token, body: { name: "Eigene Mail", docType: "INVOICE", subject: "Betreff", body: "Text" } }),
    );
    expect(res.status).toBe(201);
    templateId = (await json(res)).data.id;
    const getRes = await EmailTemplateGet(req(`http://x/api/v1/EmailTemplate/${templateId}`, { token }), ctxFor(templateId));
    expect(getRes.status).toBe(200);
    const updRes = await EmailTemplateUpdate(
      req(`http://x/api/v1/EmailTemplate/${templateId}`, { method: "PATCH", token, body: { name: "Eigene Mail", docType: "INVOICE", subject: "Neuer Betreff", body: "Text" } }),
      ctxFor(templateId),
    );
    expect(updRes.status).toBe(200);
  });

  it("Create ohne subject -> 400", async () => {
    const res = await EmailTemplateCreate(req("http://x/api/v1/EmailTemplate", { method: "POST", token, body: { name: "x", docType: "INVOICE", body: "y" } }));
    expect(res.status).toBe(400);
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────
describe("/api/v1/Settings", () => {
  it("Get liefert documents/branding/print", async () => {
    const res = await SettingsGet(req("http://x/api/v1/Settings", { token }));
    expect(res.status).toBe(200);
    const j = (await json(res)).data;
    expect(j.objectName).toBe("Settings");
    expect(j.documents).toBeDefined();
    expect(j.branding).toBeDefined();
    expect(j.print).toBeDefined();
  });

  it("Patch aktualisiert ein Fragment", async () => {
    const res = await SettingsUpdate(req("http://x/api/v1/Settings", { method: "PATCH", token, body: { documents: { quoteValidityDays: 20 } } }));
    expect(res.status).toBe(200);
    expect((await json(res)).data.documents.quoteValidityDays).toBe(20);
  });

  // Fix-Welle (Blocking 1): ein Patch-Fragment darf NICHT die restlichen Felder desselben
  // Bereichs auf ihre Defaults zuruecksetzen — vorher wurde das gesendete Fragment mit dem
  // VOLLEN Schema (Defaults fuer alles Fehlende) re-geparst und komplett upserted.
  it("Patch von nur primaryColor laesst alle anderen Branding-Felder unveraendert", async () => {
    const setup = await SettingsUpdate(
      req("http://x/api/v1/Settings", {
        method: "PATCH",
        token,
        body: { branding: { senderLine: "Musterfirma GmbH", footerLeft: "USt-IdNr. DE123", marginTopMm: 30 } },
      }),
    );
    expect(setup.status).toBe(200);

    const res = await SettingsUpdate(
      req("http://x/api/v1/Settings", { method: "PATCH", token, body: { branding: { primaryColor: "#ff0000" } } }),
    );
    expect(res.status).toBe(200);
    const branding = (await json(res)).data.branding;
    expect(branding.primaryColor).toBe("#ff0000");
    expect(branding.senderLine).toBe("Musterfirma GmbH");
    expect(branding.footerLeft).toBe("USt-IdNr. DE123");
    expect(branding.marginTopMm).toBe(30);
  });
});

// ── ApiKey ────────────────────────────────────────────────────────────────────
describe("/api/v1/ApiKey", () => {
  it("Create -> 201 mit Token, Liste ohne Token, Get, Patch revoked", async () => {
    const res = await ApiKeyCreate(req("http://x/api/v1/ApiKey", { method: "POST", token, body: { name: "Erzeugt-per-API", scopes: ["read"] } }));
    expect(res.status).toBe(201);
    const created = (await json(res)).data;
    expect(created.token).toMatch(/^oig_/);

    const listRes = await ApiKeyList(req("http://x/api/v1/ApiKey", { token }));
    expect(listRes.status).toBe(200);
    const listed = (await json(listRes)).data.find((k: { id: string }) => k.id === created.id);
    expect(listed.token).toBeUndefined();

    const getRes = await ApiKeyGet(req(`http://x/api/v1/ApiKey/${created.id}`, { token }), ctxFor(created.id));
    expect(getRes.status).toBe(200);

    const patchRes = await ApiKeyUpdate(req(`http://x/api/v1/ApiKey/${created.id}`, { method: "PATCH", token, body: { revoked: true } }), ctxFor(created.id));
    expect(patchRes.status).toBe(200);
    expect((await json(patchRes)).data.revokedAt).not.toBeNull();
  });

  it("Get fremder Org -> 404", async () => {
    const res = await ApiKeyCreate(req("http://x/api/v1/ApiKey", { method: "POST", token, body: { name: "Fremd-Test", scopes: ["read"] } }));
    const created = (await json(res)).data;
    const getRes = await ApiKeyGet(req(`http://x/api/v1/ApiKey/${created.id}`, { token: otherToken }), ctxFor(created.id));
    expect(getRes.status).toBe(404);
  });
});
