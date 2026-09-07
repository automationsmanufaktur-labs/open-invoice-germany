/**
 * Phase 7, Task 4 — Routen-Tests: Beleg-/Druck-/Briefpapier-Einstellungen, Logo-/
 * Hintergrund-Upload (Groesse/Typ), Vorschau-PDF, Nummernkreise, Druckoptionen-
 * Ueberschreibung je Beleg (nur DRAFT -> 409 sonst). Muster: dunning-routes.test.ts
 * (Route-Handler direkt aufrufen, Auth/Org gemockt). Eigenes Jahr 2057 (Testjahr-
 * Konvention, plan-header.md).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    const { dbInternal } = await import("@/lib/db");
    const org = await dbInternal.organization.findUnique({ where: { id: orgStore.id } });
    if (!org) throw new Error("Test-Org nicht gefunden.");
    return org;
  },
}));
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "tester",
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { createBusinessDocument } from "@/domain/document/create";
import type { CreateInvoiceInput } from "@/schemas";

import { GET as docSettingsGet, PUT as docSettingsPut } from "@/app/api/settings/documents/route";
import { GET as printGet, PUT as printPut } from "@/app/api/settings/print/route";
import { GET as brandingGet, PUT as brandingPut } from "@/app/api/settings/branding/route";
import { POST as uploadPost, DELETE as uploadDelete } from "@/app/api/settings/branding/upload/route";
import { GET as previewGet } from "@/app/api/settings/branding/preview/route";
import { GET as rangesGet } from "@/app/api/settings/number-ranges/route";
import { PUT as rangePut } from "@/app/api/settings/number-ranges/[docType]/route";
import { PUT as invoicePrintOptionsPut } from "@/app/api/invoices/[id]/print-options/route";
import { PUT as documentPrintOptionsPut } from "@/app/api/documents/[id]/print-options/route";
import { PUT as deliveryNotePrintOptionsPut } from "@/app/api/delivery-notes/[id]/print-options/route";

const FIX_DATE = new Date("2057-06-01T10:00:00.000Z");

let orgId: string;
let n = 0;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Routen-Einstellungen GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);
});

async function makeCustomer() {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId, name: `Kunde ${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  return c.id;
}

function invoiceInput(customerId: string): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 50000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
  } as CreateInvoiceInput;
}

function jsonRequest(url: string, body: unknown, method = "PUT"): Request {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function ctxDocType(docType: string) {
  return { params: Promise.resolve({ docType }) };
}

function pngBytes(): Buffer {
  // Minimaler gültiger PNG-Header (8 Byte Magic) + Fuellbytes — reicht fuer sniffMime.
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

describe("Beleg-Einstellungen (/api/settings/documents)", () => {
  it("GET liefert Defaults", async () => {
    const res = await docSettingsGet();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.invoiceDueDays).toBe(14);
  });

  it("PUT 200: speichert und liest zurueck", async () => {
    const res = await docSettingsPut(jsonRequest("http://x/api/settings/documents", { invoiceDueDays: 21, defaultCurrency: "CHF" }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.invoiceDueDays).toBe(21);
    expect(j.settings.defaultCurrency).toBe("CHF");
  });

  it("PUT 400: ungueltige Eingabe", async () => {
    const res = await docSettingsPut(jsonRequest("http://x/api/settings/documents", { invoiceDueDays: -5 }));
    expect(res.status).toBe(400);
  });
});

describe("Druckoptionen — global (/api/settings/print)", () => {
  it("GET liefert Defaults", async () => {
    const res = await printGet();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.showGiroCode).toBe(true);
  });

  it("PUT 200: speichert", async () => {
    const res = await printPut(jsonRequest("http://x/api/settings/print", { showGiroCode: false, foldMarks: true }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.showGiroCode).toBe(false);
    expect(j.settings.foldMarks).toBe(true);
  });

  it("PUT 400: ungueltige Eingabe (falscher Typ)", async () => {
    const res = await printPut(jsonRequest("http://x/api/settings/print", { showGiroCode: "ja" }));
    expect(res.status).toBe(400);
  });
});

describe("Briefpapier (/api/settings/branding)", () => {
  it("GET liefert Defaults", async () => {
    const res = await brandingGet();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.primaryColor).toBe("#111111");
  });

  it("PUT 200: speichert Farbe/Raender", async () => {
    const res = await brandingPut(jsonRequest("http://x/api/settings/branding", { primaryColor: "#003366", marginTopMm: 25 }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.primaryColor).toBe("#003366");
    expect(j.settings.marginTopMm).toBe(25);
  });

  it("PUT 400: ungueltiges Farbformat", async () => {
    const res = await brandingPut(jsonRequest("http://x/api/settings/branding", { primaryColor: "blau" }));
    expect(res.status).toBe(400);
  });
});

describe("Logo-/Hintergrund-Upload (/api/settings/branding/upload)", () => {
  it("POST 201: Logo-Upload setzt logoPath", async () => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(pngBytes())], "logo.png", { type: "image/png" }));
    // FormData-Bodies liefern in dieser Umgebung keinen automatischen content-length-Header
    // (siehe attachments-route.test.ts) — die Route braucht ihn fuer die Vorpruefung.
    const req = new Request("http://x/api/settings/branding/upload?kind=logo", { method: "POST", body: fd, headers: { "content-length": "100" } });
    const res = await uploadPost(req);
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(j.settings.logoPath).toBeTruthy();
  });

  it("POST 400: falscher Dateityp (PDF statt PNG/JPEG)", async () => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(Buffer.from([0x25, 0x50, 0x44, 0x46]))], "logo.pdf", { type: "application/pdf" }));
    const req = new Request("http://x/api/settings/branding/upload?kind=logo", { method: "POST", body: fd, headers: { "content-length": "100" } });
    const res = await uploadPost(req);
    expect(res.status).toBe(400);
  });

  it("POST 413: Logo zu gross (> 2 MB, Content-Length-Vorabpruefung)", async () => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(pngBytes())], "logo.png", { type: "image/png" }));
    const req = new Request("http://x/api/settings/branding/upload?kind=logo", {
      method: "POST",
      body: fd,
      headers: { "content-length": String(3 * 1024 * 1024) },
    });
    const res = await uploadPost(req);
    expect(res.status).toBe(413);
  });

  it("POST 400: kind fehlt/ungueltig", async () => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(pngBytes())], "logo.png", { type: "image/png" }));
    const req = new Request("http://x/api/settings/branding/upload?kind=sonstwas", { method: "POST", body: fd, headers: { "content-length": "100" } });
    const res = await uploadPost(req);
    expect(res.status).toBe(400);
  });

  it("DELETE: setzt logoPath auf null zurueck", async () => {
    const res = await uploadDelete(new Request("http://x/api/settings/branding/upload?kind=logo", { method: "DELETE" }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.settings.logoPath).toBeNull();
  });
});

describe("Vorschau-PDF (/api/settings/branding/preview)", () => {
  it("GET liefert ein PDF fuer INVOICE", async () => {
    const res = await previewGet(new Request("http://x/api/settings/branding/preview?docType=INVOICE"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("GET liefert ein PDF fuer DELIVERY_NOTE", async () => {
    const res = await previewGet(new Request("http://x/api/settings/branding/preview?docType=DELIVERY_NOTE"));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("GET 400: ungueltiger docType", async () => {
    const res = await previewGet(new Request("http://x/api/settings/branding/preview?docType=SONSTWAS"));
    expect(res.status).toBe(400);
  });
});

describe("Nummernkreise (/api/settings/number-ranges)", () => {
  it("GET liefert alle 9 Typen mit Vorschau", async () => {
    const res = await rangesGet(new Request("http://x/api/settings/number-ranges?year=2057"));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ranges.length).toBe(9);
    expect(j.ranges.find((r: { docType: string }) => r.docType === "INVOICE")).toBeTruthy();
  });

  it("PUT 200: aendert Praefix/Muster eines Kreises", async () => {
    const res = await rangePut(jsonRequest("http://x/api/settings/number-ranges/CUSTOMER", { pattern: "K-{SEQ:5}", prefix: "K-", seqPadding: 5, yearlyReset: false, nextValue: 1 }), ctxDocType("CUSTOMER"));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.range.prefix).toBe("K-");
  });

  it("PUT 400: unbekannter docType", async () => {
    const res = await rangePut(jsonRequest("http://x/api/settings/number-ranges/SONSTWAS", { pattern: "{SEQ}", prefix: "", seqPadding: 4, yearlyReset: false, nextValue: 1 }), ctxDocType("SONSTWAS"));
    expect(res.status).toBe(400);
  });

  it("PUT 409: Zurueckdrehen wird abgelehnt", async () => {
    // Erst einmal einen hohen Wert setzen ...
    await rangePut(jsonRequest("http://x/api/settings/number-ranges/DUNNING", { pattern: "MA-{SEQ:4}", prefix: "MA-", seqPadding: 4, yearlyReset: false, nextValue: 50 }), ctxDocType("DUNNING"));
    // ... dann versuchen, unter den bereits vergebenen Wert zu gehen.
    const res = await rangePut(jsonRequest("http://x/api/settings/number-ranges/DUNNING", { pattern: "MA-{SEQ:4}", prefix: "MA-", seqPadding: 4, yearlyReset: false, nextValue: 1 }), ctxDocType("DUNNING"));
    expect(res.status).toBe(409);
  });
});

describe("Druckoptionen je Beleg — nur DRAFT (/api/{invoices,documents,delivery-notes}/[id]/print-options)", () => {
  it("PUT 200 auf Rechnungsentwurf, 409 nach Festschreibung", async () => {
    const customerId = await makeCustomer();
    const draft = await createDraftInvoice(orgId, invoiceInput(customerId));
    const okRes = await invoicePrintOptionsPut(jsonRequest(`http://x/api/invoices/${draft.id}/print-options`, { showGiroCode: false }), ctx(draft.id));
    const okJson = await okRes.json();
    expect(okRes.status).toBe(200);
    expect(okJson.printOptions.showGiroCode).toBe(false);

    await finalizeInvoice(draft.id, { now: FIX_DATE });
    const conflictRes = await invoicePrintOptionsPut(jsonRequest(`http://x/api/invoices/${draft.id}/print-options`, { showGiroCode: true }), ctx(draft.id));
    expect(conflictRes.status).toBe(409);
  });

  it("PUT 404: unbekannte Rechnung", async () => {
    const res = await invoicePrintOptionsPut(jsonRequest("http://x/api/invoices/unbekannt/print-options", { showGiroCode: false }), ctx("unbekannt"));
    expect(res.status).toBe(404);
  });

  it("PUT 200 auf Angebotsentwurf (documents)", async () => {
    const customerId = await makeCustomer();
    const q = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 20000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const res = await documentPrintOptionsPut(jsonRequest(`http://x/api/documents/${q.id}/print-options`, { foldMarks: true }), ctx(q.id));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.printOptions.foldMarks).toBe(true);
  });

  it("PUT 200 auf Lieferschein-Entwurf (delivery-notes)", async () => {
    const customerId = await makeCustomer();
    const dn = await createDeliveryNote(orgId, {
      customerId,
      lines: [{ description: "Artikel", quantityMilli: 1000, unit: "C62" }],
    });
    // createDeliveryNote vergibt sofort status CREATED (DRAFT ist fuer das
    // Formular-Zwischenspeichern, Task 5, reserviert) — fuer den DRAFT-Test hier direkt
    // in der DB zurueckgesetzt, um den Guard unabhaengig von Task 5 zu pruefen.
    await dbInternal.deliveryNote.update({ where: { id: dn.id }, data: { status: "DRAFT" } });
    const res = await deliveryNotePrintOptionsPut(jsonRequest(`http://x/api/delivery-notes/${dn.id}/print-options`, { showFooter: false }), ctx(dn.id));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.printOptions.showFooter).toBe(false);
  });
});
