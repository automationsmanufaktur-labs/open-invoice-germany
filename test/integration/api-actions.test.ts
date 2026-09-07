/**
 * Phase 10, Task 3 — Aktions-Endpunkte + Dateien (task-3-brief.md, task-3-facts.md).
 * Testjahr 2075 (plan-header.md) fuer die org-eigenen Belegdaten (Liefer-/Faelligkeits-
 * datum). Die v1-Aktionsrouten (`finalize`/`cancel`/`dunning`/`run`) reichen KEINEN
 * `now`-Override an die Domain durch (anders als z. B. dunning-engine.test.ts) — die
 * tatsaechliche Rechnungsnummer entsteht also mit dem echten Server-Datum. Das ist
 * bewusst so belassen (kein `now`-Parameter in den Routen, siehe task-3-facts.md), nicht
 * ueber die Facts-Anforderung hinaus erweitert; bestehende Praezedenzfaelle
 * (test/integration/settings-consumption.test.ts, gobd.test.ts) finalisieren ebenfalls
 * ohne `now`-Override. Muster fuer Route-Aufrufe: test/integration/api-resources.test.ts
 * (echte API-Keys ueber createApiKey, Route-Handler direkt aufgerufen statt echtem
 * HTTP-Server).
 *
 * `sendDocumentEmail` erzeugt ohne injizierten Provider intern per
 * `createSmtpProvider(settings)` einen echten SMTP-Client — fuer den Versand-Test wird
 * dieses Modul auf einen In-Memory-Provider gemockt (Facts: "send mit
 * MemoryMailProvider"), da die v1-Routen (anders als das MCP-Tool) keinen eigenen
 * Provider-Injektionspunkt haben.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { dbInternal, prisma } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createApiKey } from "@/domain/api-key/create";
import { resetRateLimits } from "@/lib/rate-limit";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { createRecurring } from "@/domain/recurring/create";
import { saveMailSettings } from "@/domain/email/settings";
import type { CreateInvoiceInput, CreateDocumentInput } from "@/schemas";

const { sentMails, getMemoryProvider } = vi.hoisted(() => {
  const sent: Array<{ to: string[]; subject: string }> = [];
  return {
    sentMails: sent,
    getMemoryProvider: () => ({
      async send(mail: { to: string[]; subject: string }) {
        sent.push(mail);
        return { providerId: `mem-${sent.length}` };
      },
    }),
  };
});
vi.mock("@/lib/mail/smtp", () => ({ createSmtpProvider: getMemoryProvider }));

import { POST as InvoiceFinalize } from "@/app/api/v1/Invoice/[id]/finalize/route";
import { POST as InvoiceCancel } from "@/app/api/v1/Invoice/[id]/cancel/route";
import { POST as InvoiceCredit } from "@/app/api/v1/Invoice/[id]/credit/route";
import { POST as InvoicePayment } from "@/app/api/v1/Invoice/[id]/payment/route";
import { POST as InvoiceSend } from "@/app/api/v1/Invoice/[id]/send/route";
import { POST as InvoiceDunning } from "@/app/api/v1/Invoice/[id]/dunning/route";
import { GET as InvoicePdf } from "@/app/api/v1/Invoice/[id]/pdf/route";
import { GET as InvoiceXRechnung } from "@/app/api/v1/Invoice/[id]/xrechnung/route";
import { GET as InvoiceZugferd } from "@/app/api/v1/Invoice/[id]/zugferd/route";

import { POST as QuoteConvert } from "@/app/api/v1/Quote/[id]/convert/route";
import { POST as QuoteStatus } from "@/app/api/v1/Quote/[id]/status/route";
import { POST as QuoteDuplicate } from "@/app/api/v1/Quote/[id]/duplicate/route";
import { POST as QuoteShareLink } from "@/app/api/v1/Quote/[id]/share-link/route";
import { POST as QuoteSend } from "@/app/api/v1/Quote/[id]/send/route";
import { POST as QuotePartialInvoice } from "@/app/api/v1/Quote/[id]/partial-invoice/route";
import { POST as QuoteDownpaymentInvoice } from "@/app/api/v1/Quote/[id]/downpayment-invoice/route";
import { POST as QuoteFinalInvoice } from "@/app/api/v1/Quote/[id]/final-invoice/route";

import { POST as OrderConfirmationShareLink } from "@/app/api/v1/OrderConfirmation/[id]/share-link/route";
import { POST as OrderConfirmationStatus } from "@/app/api/v1/OrderConfirmation/[id]/status/route";

import { POST as DeliveryNoteStatus } from "@/app/api/v1/DeliveryNote/[id]/status/route";
import { POST as ContactAddressDefault } from "@/app/api/v1/Contact/[id]/addresses/[addressId]/default/route";
import { POST as ContactPersonDefault } from "@/app/api/v1/Contact/[id]/contacts/[contactId]/default/route";
import { GET as RecurringList, POST as RecurringCreate } from "@/app/api/v1/Recurring/route";
import { GET as RecurringGet, PATCH as RecurringUpdate } from "@/app/api/v1/Recurring/[id]/route";
import { POST as RecurringRun } from "@/app/api/v1/Recurring/[id]/run/route";
import { POST as RecurringState } from "@/app/api/v1/Recurring/[id]/state/route";

const YEAR = "2075";

let orgId: string;
let customerId: string;
let token: string; // read+write+send
let writeOnlyToken: string; // kein send

function req(url: string, opts: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {}) {
  const headers = new Headers();
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  if (opts.idempotencyKey) headers.set("idempotency-key", opts.idempotencyKey);
  return new Request(url, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

function ctx1(id: string) {
  return { params: Promise.resolve({ id }) };
}
function ctxAddress(id: string, addressId: string) {
  return { params: Promise.resolve({ id, addressId }) };
}
function ctxContact(id: string, contactId: string) {
  return { params: Promise.resolve({ id, contactId }) };
}

async function json(res: Response) {
  return res.json();
}

function invoiceInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: new Date(`${YEAR}-06-01`),
    dueDate: new Date(`${YEAR}-06-15`),
    lines: [{ description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    ...extra,
  } as CreateInvoiceInput;
}

async function makeFinalizedInvoice() {
  const draft = await createDraftInvoice(orgId, invoiceInput());
  const res = await InvoiceFinalize(req(`http://x/api/v1/Invoice/${draft.id}/finalize`, { method: "POST", token }), ctx1(draft.id));
  const { id } = (await res.json()).data;
  return prisma.invoice.findUniqueOrThrow({ where: { id } });
}

function documentInput(extra: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
  return {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 20000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    ...extra,
  } as CreateDocumentInput;
}

beforeAll(async () => {
  // Fuer createShareLink (Klartext-Token wird AES-GCM-verschluesselt gespeichert) —
  // Muster aus test/integration/quote-share.test.ts.
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: { legalName: "API-Actions Test GmbH", addressLine1: "Aktionsweg 3", postalCode: "10117", city: "Berlin", vatId: "DE333333333", taxNumber: "33/333/33333" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);

  // Die v1-Aktionsrouten (finalize/cancel/credit) reichen keinen `now`-Override an
  // assignDocumentNumber() durch — die Rechnungsnummer entsteht also mit dem echten
  // Server-Datum (real "now"). `Invoice.number` ist GLOBAL eindeutig (nicht je Org!,
  // siehe prisma/schema.prisma) — ein frisch angelegter Nummernkreis wuerde ohne diese
  // Vorbelegung mit "RE-<aktJahr>-0001" beginnen und mit dem allerersten Beleg einer
  // ANDEREN Testdatei desselben realen Jahres kollidieren (z. B. gobd.test.ts, das
  // ebenfalls ohne `now`-Override finalisiert). Fix: die Sequenz fuer diese Organisation
  // auf einen hohen, praktisch kollisionsfreien Startwert vorbelegen (INVOICE fuer
  // finalize/Teilrechnungen, CREDIT_NOTE fuer cancel/credit — beide docTypes schreiben in
  // dieselbe global-unique Invoice.number-Spalte).
  const thisYear = new Date().getFullYear();
  for (const docType of ["INVOICE", "CREDIT_NOTE"]) {
    await dbInternal.numberRange.upsert({
      where: { orgId_docType_year: { orgId, docType, year: thisYear } },
      create: { orgId, docType, year: thisYear, currentValue: 900000, prefix: docType === "INVOICE" ? "RE-" : "GS-", pattern: "{PREFIX}{YYYY}-{SEQ}", seqPadding: 4, isActive: true },
      update: { currentValue: 900000 },
    });
  }

  await saveMailSettings(orgId, {
    host: "localhost",
    port: 25,
    security: "NONE",
    fromName: "Test GmbH",
    fromEmail: "test@example.com",
    defaultCc: "",
    defaultBcc: "",
    copyToSelf: false,
  });

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Aktionskunde AG", addressLine1: "Marktplatz 3", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde@example.com" },
  });
  customerId = customer.id;

  const key = await createApiKey(orgId, { name: "Actions-Key", scopes: ["read", "write", "send", "admin"] });
  token = key.token;
  const writeOnlyKey = await createApiKey(orgId, { name: "WriteOnly-Key", scopes: ["read", "write"] });
  writeOnlyToken = writeOnlyKey.token;
  resetRateLimits();
});

describe("/api/v1/Invoice/{id}/finalize", () => {
  it("finalisiert einen Entwurf (liefert die volle Rechnung, Fix-Runde 1)", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const res = await InvoiceFinalize(req(`http://x/api/v1/Invoice/${draft.id}/finalize`, { method: "POST", token }), ctx1(draft.id));
    expect(res.status).toBe(200);
    const parsedBody = await json(res);
    const body = parsedBody.data;
    expect(body.status).toBe("FINALIZED");
    expect(body.number).toBeTruthy();
    expect(body.objectName).toBe("Invoice");

    // Fix-Runde 1 (Koordinator-Befund 2): die tatsaechliche Antwort validiert gegen
    // das im spec deklarierte Schema — kein Auseinanderlaufen von Realitaet/Doku.
    const { spec } = await import("@/app/api/v1/Invoice/[id]/finalize/route");
    expect(spec.create.response.safeParse(parsedBody).success).toBe(true);
  });

  it("zweimal festschreiben -> 409 CONFLICT", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const first = await InvoiceFinalize(req(`http://x/api/v1/Invoice/${draft.id}/finalize`, { method: "POST", token }), ctx1(draft.id));
    expect(first.status).toBe(200);
    const second = await InvoiceFinalize(req(`http://x/api/v1/Invoice/${draft.id}/finalize`, { method: "POST", token }), ctx1(draft.id));
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("CONFLICT");
  });

  it("fremde Rechnung -> 404", async () => {
    const otherOrg = await dbInternal.organization.create({ data: { legalName: "Fremd GmbH", addressLine1: "X", postalCode: "1", city: "X" } });
    await ensureOrgMasterdata(dbInternal, otherOrg.id);
    const otherCustomer = await dbInternal.customer.create({ data: { orgId: otherOrg.id, name: "Fremd", addressLine1: "X", postalCode: "1", city: "X", type: "BUSINESS" } });
    const draft = await createDraftInvoice(otherOrg.id, { ...invoiceInput(), customerId: otherCustomer.id });
    const res = await InvoiceFinalize(req(`http://x/api/v1/Invoice/${draft.id}/finalize`, { method: "POST", token }), ctx1(draft.id));
    expect(res.status).toBe(404);
  });
});

describe("/api/v1/Invoice/{id}/cancel", () => {
  it("storniert eine festgeschriebene Rechnung (liefert die volle Storno-Gutschrift, Fix-Runde 1)", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoiceCancel(req(`http://x/api/v1/Invoice/${fin.id}/cancel`, { method: "POST", token }), ctx1(fin.id));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.objectName).toBe("Invoice");
    expect(body.type).toBe("CREDIT_NOTE");
    expect(body.number).toBeTruthy();
    expect(body.correctsInvoiceId).toBe(fin.id);
  });
});

describe("/api/v1/Invoice/{id}/credit", () => {
  it("legt eine Teilgutschrift an", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoiceCredit(
      req(`http://x/api/v1/Invoice/${fin.id}/credit`, {
        method: "POST",
        token,
        body: { notes: "Reklamation", lines: [{ description: "Erstattung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S" }] },
      }),
      ctx1(fin.id),
    );
    expect(res.status).toBe(201);
    const body = (await json(res)).data;
    expect(body.type).toBe("CREDIT_NOTE");
    expect(body.number).toBeTruthy();
  });
});

describe("/api/v1/Invoice/{id}/payment", () => {
  it("erfasst eine Zahlung (liefert {payment, invoice}, Fix-Runde 1)", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoicePayment(req(`http://x/api/v1/Invoice/${fin.id}/payment`, { method: "POST", token, body: { amountCents: fin.grossTotalCents } }), ctx1(fin.id));
    expect(res.status).toBe(201);
    const parsedBody = await json(res);
    const body = parsedBody.data;
    expect(body.invoice.status).toBe("PAID");
    expect(body.payment.objectName).toBe("Payment");
    expect(body.payment.amountCents).toBe(fin.grossTotalCents);

    // Fix-Runde 1 (Koordinator-Befund 2): die tatsaechliche Antwort validiert gegen
    // das im spec deklarierte Schema — kein Auseinanderlaufen von Realitaet/Doku.
    const { spec } = await import("@/app/api/v1/Invoice/[id]/payment/route");
    expect(spec.create.response.safeParse(parsedBody).success).toBe(true);
  });

  it("Idempotency-Key: doppelter Aufruf -> genau eine Buchung", async () => {
    const fin = await makeFinalizedInvoice();
    const idemKey = `pay-${fin.id}`;
    const body = { amountCents: fin.grossTotalCents };
    const first = await InvoicePayment(req(`http://x/api/v1/Invoice/${fin.id}/payment`, { method: "POST", token, body, idempotencyKey: idemKey }), ctx1(fin.id));
    expect(first.status).toBe(201);
    const second = await InvoicePayment(req(`http://x/api/v1/Invoice/${fin.id}/payment`, { method: "POST", token, body, idempotencyKey: idemKey }), ctx1(fin.id));
    expect(second.status).toBe(201);
    expect(await json(second)).toEqual(await json(first));
    const payments = await prisma.payment.findMany({ where: { invoiceId: fin.id } });
    expect(payments).toHaveLength(1);
  });

  it("Fix-Runde 1 (Koordinator-Ruling a): unbekannte Rechnungs-ID -> 404 NOT_FOUND (nicht 409)", async () => {
    const res = await InvoicePayment(req(`http://x/api/v1/Invoice/unbekannt-123/payment`, { method: "POST", token, body: { amountCents: 100 } }), ctx1("unbekannt-123"));
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("NOT_FOUND");
  });
});

describe("/api/v1/Invoice/{id}/send", () => {
  it("versendet ueber den gemockten SMTP-Provider (MemoryMailProvider)", async () => {
    const fin = await makeFinalizedInvoice();
    const before = sentMails.length;
    const res = await InvoiceSend(
      req(`http://x/api/v1/Invoice/${fin.id}/send`, { method: "POST", token, body: { to: ["kunde@example.com"], subject: "Ihre Rechnung", body: "Anbei die Rechnung." } }),
      ctx1(fin.id),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("SENT");
    expect(sentMails.length).toBe(before + 1);
  });

  it("write-Scope ohne send -> 403", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoiceSend(
      req(`http://x/api/v1/Invoice/${fin.id}/send`, { method: "POST", token: writeOnlyToken, body: { to: ["kunde@example.com"], subject: "x", body: "y" } }),
      ctx1(fin.id),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/v1/Invoice/{id}/dunning", () => {
  it("erstellt die naechste Mahnstufe (send-Scope erforderlich)", async () => {
    const fin = await makeFinalizedInvoice();
    // Ueberfaellig machen, damit die erste Mahnstufe greift.
    await dbInternal.invoice.update({ where: { id: fin.id }, data: { dueDate: new Date("2020-01-01") } });
    const res = await InvoiceDunning(req(`http://x/api/v1/Invoice/${fin.id}/dunning`, { method: "POST", token }), ctx1(fin.id));
    expect(res.status).toBe(201);
    const body = (await json(res)).data;
    expect(body.dunning.objectName).toBe("Dunning");
    expect(body.dunning.id).toBeTruthy();
    expect(body.dunning.invoiceId).toBe(fin.id);
  });

  it("write-Scope ohne send -> 403", async () => {
    const fin = await makeFinalizedInvoice();
    await dbInternal.invoice.update({ where: { id: fin.id }, data: { dueDate: new Date("2020-01-01") } });
    const res = await InvoiceDunning(req(`http://x/api/v1/Invoice/${fin.id}/dunning`, { method: "POST", token: writeOnlyToken }), ctx1(fin.id));
    expect(res.status).toBe(403);
  });

  it("Fix-Runde 1 (Koordinator-Ruling a): unbekannte Rechnungs-ID -> 404 NOT_FOUND (nicht 409)", async () => {
    const res = await InvoiceDunning(req(`http://x/api/v1/Invoice/unbekannt-123/dunning`, { method: "POST", token }), ctx1("unbekannt-123"));
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("NOT_FOUND");
  });
});

describe("/api/v1/Invoice/{id}/pdf,xrechnung,zugferd", () => {
  it("pdf liefert PDF-Bytes", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoicePdf(req(`http://x/api/v1/Invoice/${fin.id}/pdf`, { token }), ctx1(fin.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("xrechnung liefert XML fuer eine festgeschriebene Rechnung", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoiceXRechnung(req(`http://x/api/v1/Invoice/${fin.id}/xrechnung`, { token }), ctx1(fin.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("xml");
    const text = await res.text();
    expect(text).toContain("<?xml");
  });

  it("xrechnung fuer einen Entwurf -> 409", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const res = await InvoiceXRechnung(req(`http://x/api/v1/Invoice/${draft.id}/xrechnung`, { token }), ctx1(draft.id));
    expect(res.status).toBe(409);
  });

  it("zugferd liefert ein PDF fuer eine festgeschriebene Rechnung", async () => {
    const fin = await makeFinalizedInvoice();
    const res = await InvoiceZugferd(req(`http://x/api/v1/Invoice/${fin.id}/zugferd`, { token }), ctx1(fin.id));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("Fix-Runde 1 (Koordinator-Ruling c): EN-16931-Kernvalidierung fehlgeschlagen -> 409 EINVOICE_INVALID", async () => {
    // Verkaeufer-Postanschrift ohne countryCode (BR-08) — die Pflichtangaben-Pruefung
    // beim Festschreiben (mandatory.ts) prueft countryCode NICHT, die EN-16931-
    // Kernvalidierung (en16931-core.ts) hingegen schon: das Festschreiben gelingt also,
    // der spaetere Export schlaegt fehl. Eigenes Jahr 2075 fuer diesen Beleg (real "now"
    // wuerde die vorbelegte Sequenz des Haupt-Orgs oben nicht betreffen — hier ein
    // eigener, frischer Org, der KEINE Vorbelegung braucht, da 2075 laut Testjahr-
    // Konvention exklusiv dieser Datei gehoert).
    const invalidOrg = await dbInternal.organization.create({
      data: { legalName: "Ohne Laendercode GmbH", addressLine1: "Unvollstaendig 1", postalCode: "12345", city: "Nirgendwo", country: "", vatId: "DE999999999", taxNumber: "1" },
    });
    await ensureOrgMasterdata(dbInternal, invalidOrg.id);
    const invalidCustomer = await dbInternal.customer.create({
      data: { orgId: invalidOrg.id, name: "Kunde ohne Laendercode-Org", addressLine1: "X", postalCode: "1", city: "X", type: "BUSINESS" },
    });
    const invalidKey = await createApiKey(invalidOrg.id, { name: "Invalid-Seller-Key", scopes: ["read"] });
    const draft = await createDraftInvoice(invalidOrg.id, {
      customerId: invalidCustomer.id,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      deliveryDate: new Date("2075-06-01"),
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateInvoiceInput);
    const fin = await finalizeInvoice(draft.id, { now: new Date("2075-06-01") });

    const xrechnungRes = await InvoiceXRechnung(req(`http://x/api/v1/Invoice/${fin.id}/xrechnung`, { token: invalidKey.token }), ctx1(fin.id));
    expect(xrechnungRes.status).toBe(409);
    const xrechnungBody = await json(xrechnungRes);
    expect(xrechnungBody.error.code).toBe("EINVOICE_INVALID");
    expect(xrechnungBody.error.details.issues.join(" ")).toContain("BR-08");

    const zugferdRes = await InvoiceZugferd(req(`http://x/api/v1/Invoice/${fin.id}/zugferd`, { token: invalidKey.token }), ctx1(fin.id));
    expect(zugferdRes.status).toBe(409);
    expect((await json(zugferdRes)).error.code).toBe("EINVOICE_INVALID");
  });
});

describe("/api/v1/Quote/{id}/* (Angebot)", () => {
  it("convert wandelt in eine Rechnung um (liefert die volle Rechnung, Fix-Runde 1)", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const res = await QuoteConvert(req(`http://x/api/v1/Quote/${doc.id}/convert`, { method: "POST", token, body: {} }), ctx1(doc.id));
    expect(res.status).toBe(201);
    const parsedBody = await json(res);
    expect(parsedBody.data.type).toBe("INVOICE");
    expect(parsedBody.data.objectName).toBe("Invoice");

    // Fix-Runde 1 (Koordinator-Befund 2): die tatsaechliche Antwort validiert gegen
    // das im spec deklarierte Schema (z.union aus Invoice/OrderConfirmation/DeliveryNote).
    const { spec } = await import("@/app/api/v1/Quote/[id]/convert/route");
    expect(spec.create.response.safeParse(parsedBody).success).toBe(true);
  });

  it("status: MARK_SENT setzt den Status", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const res = await QuoteStatus(req(`http://x/api/v1/Quote/${doc.id}/status`, { method: "POST", token, body: { action: "MARK_SENT" } }), ctx1(doc.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("SENT");
  });

  it("duplicate legt einen neuen Entwurf an", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const res = await QuoteDuplicate(req(`http://x/api/v1/Quote/${doc.id}/duplicate`, { method: "POST", token }), ctx1(doc.id));
    expect(res.status).toBe(201);
    const copy = (await json(res)).data;
    expect(copy.id).not.toBe(doc.id);
  });

  it("share-link erzeugt einen Annahme-Link (liefert {url,token,expiresAt}, Fix-Runde 1)", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const res = await QuoteShareLink(req(`http://x/api/v1/Quote/${doc.id}/share-link`, { method: "POST", token, body: {} }), ctx1(doc.id));
    expect(res.status).toBe(201);
    const parsedBody = await json(res);
    expect(parsedBody.data.url).toContain("/angebot/");
    expect(parsedBody.data.token).toBeTruthy();
    expect(parsedBody.data.url).toContain(parsedBody.data.token);
    expect(parsedBody.data.expiresAt).toBeTruthy();

    // Fix-Runde 1 (Koordinator-Befund 2): die tatsaechliche Antwort validiert gegen
    // das im spec deklarierte Schema.
    const { spec } = await import("@/app/api/v1/Quote/[id]/share-link/route");
    expect(spec.create.response.safeParse(parsedBody).success).toBe(true);
  });

  it("send versendet das Angebot", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const before = sentMails.length;
    const res = await QuoteSend(
      req(`http://x/api/v1/Quote/${doc.id}/send`, { method: "POST", token, body: { to: ["kunde@example.com"], subject: "Ihr Angebot", body: "Anbei." } }),
      ctx1(doc.id),
    );
    expect(res.status).toBe(200);
    expect(sentMails.length).toBe(before + 1);
  });

  it("partial-invoice legt eine Teilrechnung an", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const res = await QuotePartialInvoice(
      req(`http://x/api/v1/Quote/${doc.id}/partial-invoice`, { method: "POST", token, body: { mode: "PERCENT", permille: 500 } }),
      ctx1(doc.id),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).data.type).toBe("PARTIAL");
  });

  it("downpayment-invoice + final-invoice: vollstaendiger Abschlagsablauf", async () => {
    const doc = await createBusinessDocument(orgId, documentInput());
    const dpRes = await QuoteDownpaymentInvoice(
      req(`http://x/api/v1/Quote/${doc.id}/downpayment-invoice`, { method: "POST", token, body: { mode: "PERCENT", permille: 500 } }),
      ctx1(doc.id),
    );
    expect(dpRes.status).toBe(201);
    const dpId = (await json(dpRes)).data.id;
    const finRes = await InvoiceFinalize(req(`http://x/api/v1/Invoice/${dpId}/finalize`, { method: "POST", token }), ctx1(dpId));
    expect(finRes.status).toBe(200);

    const finalRes = await QuoteFinalInvoice(req(`http://x/api/v1/Quote/${doc.id}/final-invoice`, { method: "POST", token }), ctx1(doc.id));
    expect(finalRes.status).toBe(201);
    expect((await json(finalRes)).data.type).toBe("FINAL");
  });

  it("fremdes Angebot -> 404", async () => {
    const otherOrg = await dbInternal.organization.create({ data: { legalName: "Fremd GmbH 2", addressLine1: "X", postalCode: "1", city: "X" } });
    await ensureOrgMasterdata(dbInternal, otherOrg.id);
    const otherCustomer = await dbInternal.customer.create({ data: { orgId: otherOrg.id, name: "Fremd", addressLine1: "X", postalCode: "1", city: "X", type: "BUSINESS" } });
    const doc = await createBusinessDocument(otherOrg.id, { ...documentInput(), customerId: otherCustomer.id });
    const res = await QuoteDuplicate(req(`http://x/api/v1/Quote/${doc.id}/duplicate`, { method: "POST", token }), ctx1(doc.id));
    expect(res.status).toBe(404);
  });
});

describe("/api/v1/OrderConfirmation/{id}/*", () => {
  it("share-link ist fuer AUFTRAGSBESTAETIGUNG immer 409 (nur kind=ANGEBOT)", async () => {
    const doc = await createBusinessDocument(orgId, documentInput({ kind: "AUFTRAGSBESTAETIGUNG" }));
    const res = await OrderConfirmationShareLink(req(`http://x/api/v1/OrderConfirmation/${doc.id}/share-link`, { method: "POST", token, body: {} }), ctx1(doc.id));
    expect(res.status).toBe(409);
  });

  it("status: MARK_ACCEPTED setzt den Status", async () => {
    const doc = await createBusinessDocument(orgId, documentInput({ kind: "AUFTRAGSBESTAETIGUNG" }));
    const res = await OrderConfirmationStatus(req(`http://x/api/v1/OrderConfirmation/${doc.id}/status`, { method: "POST", token, body: { action: "MARK_ACCEPTED" } }), ctx1(doc.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("ACCEPTED");
  });
});

describe("/api/v1/DeliveryNote/{id}/status", () => {
  it("MARK_DELIVERED setzt den Status", async () => {
    const note = await createDeliveryNote(orgId, { customerId, lines: [{ description: "Ware", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 1000, taxRate: 19 }] });
    const sent = await DeliveryNoteStatus(req(`http://x/api/v1/DeliveryNote/${note.id}/status`, { method: "POST", token, body: { action: "MARK_SENT" } }), ctx1(note.id));
    expect(sent.status).toBe(200);
    const res = await DeliveryNoteStatus(req(`http://x/api/v1/DeliveryNote/${note.id}/status`, { method: "POST", token, body: { action: "MARK_DELIVERED" } }), ctx1(note.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("DELIVERED");
  });
});

describe("/api/v1/Contact/{id}/addresses,contacts/{..}/default", () => {
  it("Adresse als Standard setzen", async () => {
    const address = await dbInternal.customerAddress.create({
      data: { orgId, customerId, type: "SHIPPING", addressLine1: "Lager 1", postalCode: "1", city: "X", isDefault: false },
    });
    const res = await ContactAddressDefault(req(`http://x/api/v1/Contact/${customerId}/addresses/${address.id}/default`, { method: "POST", token }), ctxAddress(customerId, address.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.isDefault).toBe(true);
  });

  it("Ansprechpartner als Standard setzen", async () => {
    const person = await dbInternal.contactPerson.create({ data: { orgId, customerId, firstName: "Erika", lastName: "Muster", isDefault: false } });
    const res = await ContactPersonDefault(req(`http://x/api/v1/Contact/${customerId}/contacts/${person.id}/default`, { method: "POST", token }), ctxContact(customerId, person.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.isDefault).toBe(true);
  });
});

describe("/api/v1/Recurring/{id}/run,state", () => {
  it("run erzeugt sofort eine faellige Rechnung", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Wartungsvertrag",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date(`${YEAR}-01-01`),
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Wartung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await RecurringRun(req(`http://x/api/v1/Recurring/${rec.id}/run`, { method: "POST", token }), ctx1(rec.id));
    expect(res.status).toBe(201);
    const body = (await json(res)).data;
    expect(body.objectName).toBe("Invoice");
    expect(body.recurringInvoiceId).toBe(rec.id);
  });

  it("state pausiert ein Abo", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Wartungsvertrag 2",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date(`${YEAR}-01-01`),
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Wartung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await RecurringState(req(`http://x/api/v1/Recurring/${rec.id}/state`, { method: "POST", token, body: { state: "PAUSED" } }), ctx1(rec.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("PAUSED");
  });

  it("fremdes Abo -> 404", async () => {
    const otherOrg = await dbInternal.organization.create({ data: { legalName: "Fremd GmbH 3", addressLine1: "X", postalCode: "1", city: "X" } });
    await ensureOrgMasterdata(dbInternal, otherOrg.id);
    const otherCustomer = await dbInternal.customer.create({ data: { orgId: otherOrg.id, name: "Fremd", addressLine1: "X", postalCode: "1", city: "X", type: "BUSINESS" } });
    const rec = await createRecurring(otherOrg.id, {
      customerId: otherCustomer.id,
      title: "Fremdes Abo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date(`${YEAR}-01-01`),
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Wartung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await RecurringRun(req(`http://x/api/v1/Recurring/${rec.id}/run`, { method: "POST", token }), ctx1(rec.id));
    expect(res.status).toBe(404);
  });
});

describe("/api/v1/Recurring (Fix-Runde 1, Koordinator-Ruling b)", () => {
  it("Create -> 201, dann Liste (Paginierung/Filter) und Get", async () => {
    const createRes = await RecurringCreate(
      req("http://x/api/v1/Recurring", {
        method: "POST",
        token,
        body: {
          customerId,
          title: "CRUD-Abo",
          interval: "MONTHLY",
          intervalCount: 1,
          startDate: `${YEAR}-01-01`,
          paymentTermsDays: 14,
          lines: [{ lineType: "ITEM", description: "Wartung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)).data;
    expect(created.objectName).toBe("Recurring");
    expect(created.status).toBe("ACTIVE");

    const listRes = await RecurringList(req(`http://x/api/v1/Recurring?limit=1&offset=0`, { token }));
    expect(listRes.status).toBe(200);
    const listBody = await json(listRes);
    expect(listBody.limit).toBe(1);
    expect(listBody.total).toBeGreaterThanOrEqual(1);

    const filteredRes = await RecurringList(req(`http://x/api/v1/Recurring?search=CRUD-Abo`, { token }));
    expect(filteredRes.status).toBe(200);
    expect((await json(filteredRes)).data.some((r: { id: string }) => r.id === created.id)).toBe(true);

    const getRes = await RecurringGet(req(`http://x/api/v1/Recurring/${created.id}`, { token }), ctx1(created.id));
    expect(getRes.status).toBe(200);
    expect((await json(getRes)).data.title).toBe("CRUD-Abo");
  });

  it("Create mit fehlendem Pflichtfeld -> 400 VALIDATION", async () => {
    const res = await RecurringCreate(req("http://x/api/v1/Recurring", { method: "POST", token, body: { title: "Ohne Kunde" } }));
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("VALIDATION");
  });

  it("Update -> 200", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Update-Abo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date(`${YEAR}-01-01`),
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Wartung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await RecurringUpdate(req(`http://x/api/v1/Recurring/${rec.id}`, { method: "PATCH", token, body: { title: "Umbenannt" } }), ctx1(rec.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data.title).toBe("Umbenannt");
  });

  it("Get/Update fremder Org -> 404", async () => {
    const otherOrg = await dbInternal.organization.create({ data: { legalName: "Fremd GmbH 4", addressLine1: "X", postalCode: "1", city: "X" } });
    await ensureOrgMasterdata(dbInternal, otherOrg.id);
    const otherCustomer = await dbInternal.customer.create({ data: { orgId: otherOrg.id, name: "Fremd", addressLine1: "X", postalCode: "1", city: "X", type: "BUSINESS" } });
    const rec = await createRecurring(otherOrg.id, {
      customerId: otherCustomer.id,
      title: "Fremdes CRUD-Abo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date(`${YEAR}-01-01`),
      paymentTermsDays: 14,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Wartung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const getRes = await RecurringGet(req(`http://x/api/v1/Recurring/${rec.id}`, { token }), ctx1(rec.id));
    expect(getRes.status).toBe(404);
    const updRes = await RecurringUpdate(req(`http://x/api/v1/Recurring/${rec.id}`, { method: "PATCH", token, body: { title: "x" } }), ctx1(rec.id));
    expect(updRes.status).toBe(404);
  });
});
