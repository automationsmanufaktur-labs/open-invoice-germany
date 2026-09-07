/**
 * Phase 7, Task 2 — Konsum der DocumentSettings in den Anlage-/Festschreib-/
 * Versandpfaden, Kunden-/Artikelnummern, Wiederkehrend. Eigenes Jahr fuer die
 * Nummernvergabe: 2054 (Plan-Header).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { convertDocument } from "@/domain/document/convert";
import { saveDocumentSettings } from "@/domain/document/settings";
import { savePrintSettings, loadPrintSettings, effectivePrintOptions, DEFAULT_PRINT_SETTINGS } from "@/domain/settings/print";
import { saveMailSettings } from "@/domain/email/settings";
import { sendDocumentEmail } from "@/domain/email/send";
import { prefillEmail } from "@/domain/email/compose";
import { assignCustomerNumber, assignArticleNumber, ensureCustomerNumbers, ensureArticleNumbers, updateNumberRange } from "@/domain/numbering/ranges";
import { createRecurring } from "@/domain/recurring/create";
import { emitRecurringNow } from "@/domain/recurring/run";
import { createMemoryProvider } from "@/lib/mail/memory";
import type { CreateInvoiceInput } from "@/schemas";

const FIX_DATE = new Date("2054-03-10T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let orgId: string;
let customerId: string;
let n = 0;

const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 };

async function makeOrg() {
  const org = await dbInternal.organization.create({
    data: { legalName: "Settings-Konsum GmbH", addressLine1: "Weg 1", postalCode: "10115", city: "Berlin", vatId: "DE111222333", taxNumber: "1" },
  });
  await ensureOrgMasterdata(dbInternal, org.id);
  return org.id;
}

async function makeCustomer(org: string, email?: string) {
  n += 1;
  const c = await dbInternal.customer.create({
    data: { orgId: org, name: `Kunde ${n} GmbH`, addressLine1: "Marktplatz 1", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: email ?? null },
  });
  return c.id;
}

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";
  orgId = await makeOrg();
  customerId = await makeCustomer(orgId, "kunde@example.org");
  // Eigenes, im gesamten Repo einmaliges Praefix fuer den INVOICE-Nummernkreis dieser Org
  // (Lastenheft `Invoice.number` ist GLOBAL eindeutig): einige Faelle unten (`refreshIssueDateOnFinalize`)
  // testen bewusst gegen den echten Systemtag und rufen `finalizeInvoice` ohne explizites
  // `now` auf — das jahresbasierte Standardmuster (`RE-{YYYY}-...`) wuerde dann mit anderen
  // Testdateien kollidieren, die zufaellig dasselbe echte Kalenderjahr nutzen.
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ:5}", prefix: "STC7X-", seqPadding: 5, yearlyReset: true, nextValue: 1 }, "system");
});

function invoiceInput(overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    documentDiscountPermille: 0,
    documentDiscountCents: 0,
    documentChargePermille: 0,
    documentChargeCents: 0,
    lines: [line],
    ...overrides,
  } as CreateInvoiceInput;
}

describe("Phase 7, Task 2 — Faelligkeit (invoiceDueDays, PaymentMethod-Prioritaet)", () => {
  it("ohne explizite Faelligkeit/Zahlungsmethode: issueDate + DocumentSettings.invoiceDueDays", async () => {
    await saveDocumentSettings(orgId, { invoiceDueDays: 21 });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    expect(inv.dueDate?.toISOString()).toBe(new Date(FIX_DATE.getTime() + 21 * DAY_MS).toISOString());
    await saveDocumentSettings(orgId, { invoiceDueDays: 14 }); // zurueck auf Default
  });

  it("Zahlungsmethode.paymentTermsDays schlaegt DocumentSettings.invoiceDueDays", async () => {
    await saveDocumentSettings(orgId, { invoiceDueDays: 21 });
    const method = await dbInternal.paymentMethod.create({
      data: { orgId, code: "VORKASSE_TEST", name: "Vorkasse Test", paymentTermsDays: 5 },
    });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE, paymentMethodId: method.id }));
    expect(inv.dueDate?.toISOString()).toBe(new Date(FIX_DATE.getTime() + 5 * DAY_MS).toISOString());
    await saveDocumentSettings(orgId, { invoiceDueDays: 14 });
  });

  it("S1 (Fix-Welle): Customer.defaultPaymentTermsDays schlaegt Zahlungsmethode.paymentTermsDays", async () => {
    const method = await dbInternal.paymentMethod.create({
      data: { orgId, code: "S1_METHOD", name: "S1-Methode", paymentTermsDays: 5 },
    });
    const custom = await makeCustomer(orgId);
    await dbInternal.customer.update({ where: { id: custom }, data: { defaultPaymentTermsDays: 30 } });
    const inv = await createDraftInvoice(orgId, invoiceInput({ customerId: custom, issueDate: FIX_DATE, paymentMethodId: method.id }));
    expect(inv.dueDate?.toISOString()).toBe(new Date(FIX_DATE.getTime() + 30 * DAY_MS).toISOString());
  });
});

describe("Phase 7, Task 2 — defaultPaymentMethodId (Org-Fallback)", () => {
  it("ohne Zahlungsmethode am Kunden/Beleg greift DocumentSettings.defaultPaymentMethodId", async () => {
    const method = await dbInternal.paymentMethod.create({ data: { orgId, code: "SEPA_TEST", name: "SEPA Test" } });
    await saveDocumentSettings(orgId, { defaultPaymentMethodId: method.id });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    expect(inv.paymentMethodId).toBe(method.id);
    await saveDocumentSettings(orgId, { defaultPaymentMethodId: null });
  });

  it("ohne Org-Standard bleibt paymentMethodId leer", async () => {
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    expect(inv.paymentMethodId).toBeNull();
  });
});

describe("Phase 7, Task 2 — autoDeliveryDate", () => {
  it("an: fehlt jedes Leistungsdatum-Feld, wird issueDate als deliveryDate uebernommen", async () => {
    await saveDocumentSettings(orgId, { autoDeliveryDate: true });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    expect(inv.deliveryDate?.toISOString()).toBe(FIX_DATE.toISOString());
  });

  it("aus: deliveryDate bleibt leer", async () => {
    await saveDocumentSettings(orgId, { autoDeliveryDate: false });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    expect(inv.deliveryDate).toBeNull();
    await saveDocumentSettings(orgId, { autoDeliveryDate: true });
  });
});

describe("Phase 7, Task 2 — refreshIssueDateOnFinalize", () => {
  it("an: ein Entwurf-issueDate vor dem heutigen Kalendertag wird beim Festschreiben nachgezogen, dueDate um dieselbe Differenz verschoben", async () => {
    await saveDocumentSettings(orgId, { refreshIssueDateOnFinalize: true });
    const past = new Date(Date.now() - 3 * DAY_MS);
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: past, dueDate: new Date(past.getTime() + 14 * DAY_MS) }));
    const finalized = await finalizeInvoice(draft.id);
    const today = new Date();
    expect(finalized.issueDate.toDateString()).toBe(today.toDateString());
    const shiftedDays = Math.round((finalized.dueDate!.getTime() - (past.getTime() + 14 * DAY_MS)) / DAY_MS);
    expect(shiftedDays).toBe(3);

    const log = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "INVOICE", entityId: finalized.id, action: "FINALIZE" }, orderBy: { id: "desc" } });
    const diff = JSON.parse(log!.diffJson) as Record<string, unknown>;
    expect(diff.issueDateBefore).toBeTruthy();
    expect(diff.issueDateAfter).toBeTruthy();
  });

  it("aus: Entwurf-issueDate bleibt beim Festschreiben unveraendert", async () => {
    await saveDocumentSettings(orgId, { refreshIssueDateOnFinalize: false });
    const past = new Date(Date.now() - 3 * DAY_MS);
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: past, dueDate: new Date(past.getTime() + 14 * DAY_MS) }));
    const finalized = await finalizeInvoice(draft.id);
    expect(finalized.issueDate.toISOString()).toBe(past.toISOString());
    await saveDocumentSettings(orgId, { refreshIssueDateOnFinalize: true });
  });

  it("greift NICHT bei explizit uebergebenem opts.issueDate, auch wenn die Einstellung an ist", async () => {
    const past = new Date(Date.now() - 3 * DAY_MS);
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: past }));
    const explicit = new Date(Date.now() - 1 * DAY_MS);
    const finalized = await finalizeInvoice(draft.id, { issueDate: explicit });
    expect(finalized.issueDate.toISOString()).toBe(explicit.toISOString());
  });
});

describe("Phase 7, Task 2 — quoteValidityDays", () => {
  it("Angebot ohne validUntil bekommt issueDate + quoteValidityDays", async () => {
    await saveDocumentSettings(orgId, { quoteValidityDays: 30 });
    const q = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
    expect(q.validUntil?.toISOString()).toBe(new Date(FIX_DATE.getTime() + 30 * DAY_MS).toISOString());
  });

  it("Auftragsbestaetigung bekommt KEIN automatisches validUntil", async () => {
    const ab = await createBusinessDocument(orgId, { kind: "AUFTRAGSBESTAETIGUNG", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
    expect(ab.validUntil).toBeNull();
  });
});

describe("Phase 7, Task 2 — defaultCurrency (Fix-Runde 1)", () => {
  it("Rechnung ohne explizite Waehrung bekommt DocumentSettings.defaultCurrency", async () => {
    await saveDocumentSettings(orgId, { defaultCurrency: "CHF" });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE, currency: undefined }));
    expect(inv.currency).toBe("CHF");
    await saveDocumentSettings(orgId, { defaultCurrency: "EUR" });
  });

  it("Rechnung mit expliziter Waehrung ignoriert DocumentSettings.defaultCurrency", async () => {
    await saveDocumentSettings(orgId, { defaultCurrency: "CHF" });
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE, currency: "USD" }));
    expect(inv.currency).toBe("USD");
    await saveDocumentSettings(orgId, { defaultCurrency: "EUR" });
  });

  it("Angebot ohne explizite Waehrung bekommt DocumentSettings.defaultCurrency", async () => {
    await saveDocumentSettings(orgId, { defaultCurrency: "CHF" });
    const q = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", lines: [line] }, { now: FIX_DATE });
    expect(q.currency).toBe("CHF");
    await saveDocumentSettings(orgId, { defaultCurrency: "EUR" });
  });

  it("Abo ohne explizite Waehrung bekommt DocumentSettings.defaultCurrency", async () => {
    await saveDocumentSettings(orgId, { defaultCurrency: "CHF" });
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo ohne Waehrung",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      paymentTermsDays: 14,
      autoFinalize: false,
      autoSend: false,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    expect(rec.currency).toBe("CHF");
    await saveDocumentSettings(orgId, { defaultCurrency: "EUR" });
  });

  it("ohne Org-Standard bleibt es beim letzten Rueckfall EUR", async () => {
    const inv = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE, currency: undefined }));
    expect(inv.currency).toBe("EUR");
  });
});

describe("Phase 7 — S6 (Fix-Welle): effektive Druckoptionen werden bei Festschreibung eingefroren", () => {
  it("eine globale Aenderung NACH der Festschreibung veraendert die Druckoptionen des Belegs nicht mehr", async () => {
    await savePrintSettings(orgId, { showTaxRatePerLine: true, showLineTotals: true });
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    expect(draft.printOptionsJson).toBeNull();

    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const frozen = JSON.parse(finalized.printOptionsJson!);
    expect(frozen.showTaxRatePerLine).toBe(true);
    expect(frozen.showLineTotals).toBe(true);

    // Globale Aenderung NACH der Festschreibung
    await savePrintSettings(orgId, { showTaxRatePerLine: false, showLineTotals: false });
    const global = await loadPrintSettings(orgId);
    const effective = effectivePrintOptions(global, finalized.printOptionsJson);
    expect(effective.showTaxRatePerLine).toBe(true);
    expect(effective.showLineTotals).toBe(true);

    await savePrintSettings(orgId, { showTaxRatePerLine: true, showLineTotals: true }); // zurueck auf Default
  });

  it("ein bereits vollstaendiger Beleg-Override bleibt beim Einfrieren unveraendert", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    const fullOverride = { ...DEFAULT_PRINT_SETTINGS, showGiroCode: false };
    await dbInternal.invoice.update({ where: { id: draft.id }, data: { printOptionsJson: JSON.stringify(fullOverride) } });

    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    expect(JSON.parse(finalized.printOptionsJson!)).toEqual(fullOverride);
  });
});

describe("Phase 7, Task 2 — Lieferschein-Defaults (dnShowPrices/dnShowArticleNumber/dnShowDeliveryAddress) bei Konvertierung", () => {
  async function makeFinalizedSourceInvoice() {
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE }));
    return finalizeInvoice(draft.id, { now: FIX_DATE });
  }

  it("an: Lieferschein aus Konvertierung uebernimmt die Org-Einstellungen", async () => {
    await saveDocumentSettings(orgId, { dnShowPrices: true, dnShowArticleNumber: true, dnShowDeliveryAddress: true });
    const inv = await makeFinalizedSourceInvoice();
    const result = await convertDocument(orgId, { fromType: "INVOICE", fromId: inv.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE });
    const note = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: result.id } });
    expect(note.showPrices).toBe(true);
    expect(note.showArticleNumber).toBe(true);
    expect(note.showDeliveryAddress).toBe(true);
  });

  it("aus: Lieferschein aus Konvertierung uebernimmt die Org-Einstellungen (false)", async () => {
    await saveDocumentSettings(orgId, { dnShowPrices: false, dnShowArticleNumber: false, dnShowDeliveryAddress: false });
    const inv = await makeFinalizedSourceInvoice();
    const result = await convertDocument(orgId, { fromType: "INVOICE", fromId: inv.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE });
    const note = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: result.id } });
    expect(note.showPrices).toBe(false);
    expect(note.showArticleNumber).toBe(false);
    expect(note.showDeliveryAddress).toBe(false);
    await saveDocumentSettings(orgId, { dnShowPrices: false, dnShowArticleNumber: true, dnShowDeliveryAddress: true }); // zurueck auf Default
  });
});

describe("Phase 7, Task 2 — autoFinalizeOnSend", () => {
  beforeAll(async () => {
    await saveMailSettings(orgId, {
      host: "localhost", port: 2525, security: "NONE",
      fromName: "Settings-Konsum GmbH", fromEmail: "rechnung@example.org",
      defaultCc: "", defaultBcc: "", copyToSelf: false,
    });
  });

  it("an: ein Rechnungsentwurf wird vor dem Versand automatisch festgeschrieben", async () => {
    await saveDocumentSettings(orgId, { autoFinalizeOnSend: true });
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE, deliveryDate: FIX_DATE }));
    const result = await sendDocumentEmail(
      orgId,
      "tester",
      { docType: "INVOICE", docId: draft.id, to: "kunde@example.org", cc: "", bcc: "", subject: "Ihre Rechnung", body: "Hallo", standardAttachments: [] },
      [],
      createMemoryProvider(),
    );
    expect(result.status).toBe("SENT");
    const after = await dbInternal.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("FINALIZED");
    expect(after.number).not.toBeNull();
  });

  it("aus: ein Rechnungsentwurf bleibt beim Versand ein Entwurf", async () => {
    await saveDocumentSettings(orgId, { autoFinalizeOnSend: false });
    const draft = await createDraftInvoice(orgId, invoiceInput({ issueDate: FIX_DATE, deliveryDate: FIX_DATE }));
    await sendDocumentEmail(
      orgId,
      "tester",
      { docType: "INVOICE", docId: draft.id, to: "kunde@example.org", cc: "", bcc: "", subject: "Ihre Rechnung", body: "Hallo", standardAttachments: [] },
      [],
      createMemoryProvider(),
    );
    const after = await dbInternal.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("DRAFT");
    expect(after.number).toBeNull();
  });
});

describe("Phase 7, Task 2 — eInvoiceDefault (Standardanhaenge-Vorbelegung)", () => {
  it("an: XRechnung-XML ist beim Vorbelegen vorausgewaehlt", async () => {
    await saveDocumentSettings(orgId, { eInvoiceDefault: true });
    const b2gCustomer = await makeCustomer(orgId);
    await dbInternal.customer.update({ where: { id: b2gCustomer }, data: { leitwegId: "04011000-12345-67" } });
    const draft = await createDraftInvoice(orgId, invoiceInput({ customerId: b2gCustomer, issueDate: FIX_DATE, deliveryDate: FIX_DATE }));
    const inv = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: inv.id });
    expect(pre.defaultStandardAttachments.some((f) => f.toLowerCase().endsWith(".xml"))).toBe(true);
  });

  it("aus: nur das PDF ist vorausgewaehlt, die XML bleibt abwaehlbar aber nicht vorbelegt", async () => {
    await saveDocumentSettings(orgId, { eInvoiceDefault: false });
    const b2gCustomer = await makeCustomer(orgId);
    await dbInternal.customer.update({ where: { id: b2gCustomer }, data: { leitwegId: "04011000-12345-68" } });
    const draft = await createDraftInvoice(orgId, invoiceInput({ customerId: b2gCustomer, issueDate: FIX_DATE, deliveryDate: FIX_DATE }));
    const inv = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: inv.id });
    expect(pre.attachments.some((a) => a.filename.toLowerCase().endsWith(".xml"))).toBe(true); // die XML existiert weiterhin als waehlbarer Anhang
    expect(pre.defaultStandardAttachments.some((f) => f.toLowerCase().endsWith(".xml"))).toBe(false); // nur nicht vorausgewaehlt
    await saveDocumentSettings(orgId, { eInvoiceDefault: true });
  });
});

describe("Phase 7, Task 2 — shareLinkDefaultOn (Fix-Runde 1: Minting jetzt in prefillEmail/resolveOfferLink)", () => {
  async function makeQuote() {
    return createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
  }

  it("an: das Vorbelegen einer Angebots-Mail erzeugt automatisch einen Annahme-Link, wenn keiner aktiv ist", async () => {
    const originalBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://instanz.example.org";
    await saveDocumentSettings(orgId, { shareLinkDefaultOn: true });
    const q = await makeQuote();
    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    expect(pre.body).toContain("https://instanz.example.org/angebot/");
    const links = await dbInternal.quoteShareLink.findMany({ where: { orgId, quoteId: q.id } });
    expect(links.length).toBe(1);
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("aus: das Vorbelegen einer Angebots-Mail erzeugt KEINEN Annahme-Link", async () => {
    const originalBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://instanz.example.org";
    await saveDocumentSettings(orgId, { shareLinkDefaultOn: false });
    const q = await makeQuote();
    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    expect(pre.body).not.toContain("/angebot/");
    const links = await dbInternal.quoteShareLink.findMany({ where: { orgId, quoteId: q.id } });
    expect(links.length).toBe(0);
    await saveDocumentSettings(orgId, { shareLinkDefaultOn: true });
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });
});

describe("Phase 7, Task 2 — Kunden-/Artikelnummern", () => {
  it("assignCustomerNumber vergibt KD-00001, KD-00002, ... fortlaufend je Organisation", async () => {
    const org = await makeOrg();
    const a = await dbInternal.$transaction((tx) => assignCustomerNumber(tx, org));
    const b = await dbInternal.$transaction((tx) => assignCustomerNumber(tx, org));
    expect(a).toBe("KD-00001");
    expect(b).toBe("KD-00002");
  });

  it("assignArticleNumber vergibt ART-00001 unabhaengig vom Kundennummernkreis", async () => {
    const org = await makeOrg();
    const article = await dbInternal.$transaction((tx) => assignArticleNumber(tx, org));
    expect(article).toBe("ART-00001");
  });

  it("ensureCustomerNumbers heilt Bestandskunden ohne Nummer nach, aufsteigend nach createdAt, idempotent", async () => {
    const org = await makeOrg();
    const c1 = await dbInternal.customer.create({ data: { orgId: org, name: "Alt-Kunde 1", addressLine1: "A", postalCode: "1", city: "A" } });
    await new Promise((r) => setTimeout(r, 5));
    const c2 = await dbInternal.customer.create({ data: { orgId: org, name: "Alt-Kunde 2", addressLine1: "A", postalCode: "1", city: "A" } });

    await ensureCustomerNumbers(org);
    const after1 = await dbInternal.customer.findUniqueOrThrow({ where: { id: c1.id } });
    const after2 = await dbInternal.customer.findUniqueOrThrow({ where: { id: c2.id } });
    expect(after1.customerNumber).toBe("KD-00001");
    expect(after2.customerNumber).toBe("KD-00002");

    // idempotent: zweiter Lauf vergibt nichts erneut
    await ensureCustomerNumbers(org);
    const after1Again = await dbInternal.customer.findUniqueOrThrow({ where: { id: c1.id } });
    expect(after1Again.customerNumber).toBe("KD-00001");
  });

  it("Nit (Final-Review): ensureArticleNumbers heilt Bestandsprodukte ohne Artikelnummer nach, aufsteigend nach createdAt, idempotent", async () => {
    const org = await makeOrg();
    const p1 = await dbInternal.product.create({ data: { orgId: org, name: "Alt-Produkt 1", netPriceCents: 1000 } });
    await new Promise((r) => setTimeout(r, 5));
    const p2 = await dbInternal.product.create({ data: { orgId: org, name: "Alt-Produkt 2", netPriceCents: 2000 } });

    await ensureArticleNumbers(org);
    const after1 = await dbInternal.product.findUniqueOrThrow({ where: { id: p1.id } });
    const after2 = await dbInternal.product.findUniqueOrThrow({ where: { id: p2.id } });
    expect(after1.articleNumber).toBe("ART-00001");
    expect(after2.articleNumber).toBe("ART-00002");

    // idempotent: zweiter Lauf vergibt nichts erneut
    await ensureArticleNumbers(org);
    const after1Again = await dbInternal.product.findUniqueOrThrow({ where: { id: p1.id } });
    expect(after1Again.articleNumber).toBe("ART-00001");
  });
});

describe("Phase 7, Task 2 — Wiederkehrende Rechnungen (recurringAutoFinalizeDefault/recurringAutoSendDefault/recurringInsertPeriodText)", () => {
  it("Anlage ohne explizite Angabe uebernimmt die Org-Defaults", async () => {
    await saveDocumentSettings(orgId, { recurringAutoFinalizeDefault: true, recurringAutoSendDefault: true });
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Wartungsvertrag",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    expect(rec.autoFinalize).toBe(true);
    expect(rec.autoSend).toBe(true);
    await saveDocumentSettings(orgId, { recurringAutoFinalizeDefault: false, recurringAutoSendDefault: false });
  });

  it("explizite Angabe schlaegt den Org-Default", async () => {
    await saveDocumentSettings(orgId, { recurringAutoFinalizeDefault: true, recurringAutoSendDefault: true });
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Wartungsvertrag 2",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      autoSend: false,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    expect(rec.autoFinalize).toBe(false);
    expect(rec.autoSend).toBe(false);
    await saveDocumentSettings(orgId, { recurringAutoFinalizeDefault: false, recurringAutoSendDefault: false });
  });

  it("S4 (Fix-Welle): autoSend ohne explizites autoFinalize erzwingt autoFinalize (Versand setzt Festschreibung voraus)", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo autoSend ohne autoFinalize",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      autoSend: true,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    expect(rec.autoFinalize).toBe(true);
    expect(rec.autoSend).toBe(true);

    const emitted = await emitRecurringNow(rec.id, { now: FIX_DATE });
    expect(emitted.finalized).toBe(true);
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: emitted.invoiceId } });
    expect(invoice.status).not.toBe("DRAFT");
    expect(invoice.number).not.toBeNull();
  });

  // S5 (Fix-Welle, Final-Review): NewRecurringForm.tsx sendet `currency: undefined` statt
  // hartcodiert "EUR" — die Domain-Fallback-Kette (createRecurring faellt bei fehlender
  // Waehrung auf DocumentSettings.defaultCurrency zurueck) ist bereits oben abgedeckt
  // ("Abo ohne explizite Waehrung bekommt DocumentSettings.defaultCurrency").

  it("recurringInsertPeriodText an: erzeugte Rechnung bekommt Kopftext 'Abrechnungszeitraum dd.mm.yyyy – dd.mm.yyyy'", async () => {
    await saveDocumentSettings(orgId, { recurringInsertPeriodText: true });
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo mit Zeitraumtext",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      autoSend: false,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    const emitted = await emitRecurringNow(rec.id, { now: FIX_DATE });
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: emitted.invoiceId } });
    expect(invoice.headerText).toMatch(/^Abrechnungszeitraum \d{2}\.\d{2}\.\d{4} – \d{2}\.\d{2}\.\d{4}$/);
  });

  it("recurringInsertPeriodText aus: erzeugte Rechnung bekommt keinen Kopftext", async () => {
    await saveDocumentSettings(orgId, { recurringInsertPeriodText: false });
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Abo ohne Zeitraumtext",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      autoSend: false,
      lines: [{ lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 }],
    });
    const emitted = await emitRecurringNow(rec.id, { now: FIX_DATE });
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: emitted.invoiceId } });
    expect(invoice.headerText).toBeNull();
    await saveDocumentSettings(orgId, { recurringInsertPeriodText: true });
  });
});
