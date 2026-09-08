/**
 * Phase 8a, Task 2 — "Letztes Dokument uebernehmen" (§32): findLastDocumentForCustomer,
 * buildTakeOverPrefill. Rein lesend — keine Relation, kein ChangeLog, kein Schreibzugriff.
 *
 * Testjahr laut Plan-Header: 2060 (consumption/take-over).
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { setQuoteStatus } from "@/domain/document/status";
import { findLastDocumentForCustomer, buildTakeOverPrefill } from "@/domain/document/take-over";
import type { CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
const ISSUE = new Date("2060-04-01T10:00:00.000Z");

function invoiceInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    issueDate: ISSUE,
    deliveryDate: ISSUE,
    lines: [
      { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 100, discountCents: 0 },
    ],
    documentDiscountPermille: 50,
    documentDiscountCents: 0,
    headerText: "KOPFTEXT",
    footerText: "FUSSTEXT",
    paymentTerms: "10 Tage netto.",
    ...extra,
  } as CreateInvoiceInput;
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Take-Over Test GmbH", addressLine1: "Uebernahmeweg 1", postalCode: "12399", city: "Berlin", vatId: "DE111222333" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  // Invoice.number ist GLOBAL eindeutig (@unique, ueber alle Organisationen hinweg) —
  // mehrere Test-Dateien im selben Testjahr (2060, siehe Plan-Header) wuerden sonst beide
  // bei "RE-2060-0001" kollidieren. Eigener Praefix je Datei schliesst das aus.
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "TOV-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", ISSUE);
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Take-Over Kunde", addressLine1: "Kundenweg 1", postalCode: "54321", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

describe("findLastDocumentForCustomer", () => {
  it("liefert null ohne Belege", async () => {
    const other = await dbInternal.customer.create({ data: { orgId, name: "Leerer Kunde", addressLine1: "X", postalCode: "1", city: "Y" } });
    expect(await findLastDocumentForCustomer(orgId, other.id, "INVOICE")).toBeNull();
  });

  it("ignoriert Entwuerfe — nur festgeschriebene Rechnungen zaehlen", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput());
    expect(await findLastDocumentForCustomer(orgId, customerId, "INVOICE")).toBeNull();

    const finalized = await finalizeInvoice(draft.id, { now: ISSUE });
    const last = await findLastDocumentForCustomer(orgId, customerId, "INVOICE");
    expect(last).toMatchObject({ id: finalized.id, kind: "INVOICE" });
  });

  it("liefert den zeitlich neuesten Beleg", async () => {
    const older = await finalizeInvoice((await createDraftInvoice(orgId, invoiceInput({ issueDate: new Date("2060-01-01T00:00:00.000Z") }))).id, {
      now: new Date("2060-01-01T00:00:00.000Z"),
    });
    const newer = await finalizeInvoice((await createDraftInvoice(orgId, invoiceInput({ issueDate: new Date("2060-05-01T00:00:00.000Z") }))).id, {
      now: new Date("2060-05-01T00:00:00.000Z"),
    });
    const last = await findLastDocumentForCustomer(orgId, customerId, "INVOICE");
    expect(last?.id).toBe(newer.id);
    expect(last?.id).not.toBe(older.id);
  });

  it("QUOTE/ORDER_CONFIRMATION unterscheiden nach kind, ignorieren Entwuerfe", async () => {
    const quoteCustomer = await dbInternal.customer.create({ data: { orgId, name: "Angebotskunde", addressLine1: "X", postalCode: "1", city: "Y" } });
    const draftQuote = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: quoteCustomer.id,
      taxScheme: "REGULAR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    expect(await findLastDocumentForCustomer(orgId, quoteCustomer.id, "QUOTE")).toBeNull();

    await setQuoteStatus(orgId, draftQuote.id, "SENT");
    const last = await findLastDocumentForCustomer(orgId, quoteCustomer.id, "QUOTE");
    expect(last).toMatchObject({ id: draftQuote.id, kind: "QUOTE" });
    expect(await findLastDocumentForCustomer(orgId, quoteCustomer.id, "ORDER_CONFIRMATION")).toBeNull();
  });
});

describe("buildTakeOverPrefill", () => {
  it("liefert Zeilen/Texte/Konditionen mit Preisen (prices: true)", async () => {
    const finalized = await finalizeInvoice((await createDraftInvoice(orgId, invoiceInput())).id, { now: ISSUE });
    const prefill = await buildTakeOverPrefill(orgId, finalized.id, { lines: true, texts: true, terms: true, prices: true });

    expect(prefill.lines).toHaveLength(1);
    expect(prefill.lines?.[0]).toMatchObject({ description: "Beratung", unitNetPriceCents: 10000, discountPermille: 100 });
    expect(prefill.headerText).toBe("KOPFTEXT");
    expect(prefill.footerText).toBe("FUSSTEXT");
    expect(prefill.paymentTerms).toBe("10 Tage netto.");
    expect(prefill.documentDiscount).toEqual({ permille: 50, cents: 0 });
  });

  it("prices: false nullt Preise/Rabatt der Zeilen, behaelt Gliederung/Mengen", async () => {
    const finalized = await finalizeInvoice((await createDraftInvoice(orgId, invoiceInput())).id, { now: ISSUE });
    const prefill = await buildTakeOverPrefill(orgId, finalized.id, { lines: true, texts: false, terms: false, prices: false });

    expect(prefill.lines?.[0]).toMatchObject({ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 0, discountPermille: 0, discountCents: 0 });
    expect(prefill.headerText).toBeUndefined();
    expect(prefill.footerText).toBeUndefined();
    expect(prefill.paymentTerms).toBeUndefined();
    expect(prefill.documentDiscount).toBeUndefined();
  });

  it("opts steuern gezielt, was uebernommen wird (lines: false laesst lines weg)", async () => {
    const finalized = await finalizeInvoice((await createDraftInvoice(orgId, invoiceInput())).id, { now: ISSUE });
    const prefill = await buildTakeOverPrefill(orgId, finalized.id, { lines: false, texts: true, terms: false, prices: false });
    expect(prefill.lines).toBeUndefined();
    expect(prefill.headerText).toBe("KOPFTEXT");
  });

  it("internalNotes wird nie uebernommen (§48)", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput({ internalNotes: "GEHEIME NOTIZ" }));
    const finalized = await finalizeInvoice(draft.id, { now: ISSUE });
    const prefill = await buildTakeOverPrefill(orgId, finalized.id, { lines: true, texts: true, terms: true, prices: true });
    expect(JSON.stringify(prefill)).not.toContain("GEHEIME NOTIZ");
  });

  it("funktioniert auch fuer ein Geschaeftsdokument (Quote) inkl. deliveryTerms", async () => {
    const quoteCustomer = await dbInternal.customer.create({ data: { orgId, name: "Quote-Prefill-Kunde", addressLine1: "X", postalCode: "1", city: "Y" } });
    const doc = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: quoteCustomer.id,
      taxScheme: "REGULAR",
      deliveryTerms: "Frei Haus.",
      paymentTerms: "7 Tage.",
      documentDiscountPermille: 30,
      lines: [{ lineType: "ITEM", description: "Ware", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const prefill = await buildTakeOverPrefill(orgId, doc.id, { lines: true, texts: false, terms: true, prices: true });
    expect(prefill.paymentTerms).toBe("7 Tage.");
    expect(prefill.deliveryTerms).toBe("Frei Haus.");
    expect(prefill.documentDiscount).toEqual({ permille: 30, cents: 0 });
  });

  it("unbekannte oder fremde ID wirft NotFoundError (auch fremde Org)", async () => {
    await expect(buildTakeOverPrefill(orgId, "does-not-exist", { lines: true, texts: false, terms: false, prices: false })).rejects.toBeInstanceOf(NotFoundError);

    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "Fremde Org GmbH", addressLine1: "X", postalCode: "1", city: "Y" },
    });
    const finalized = await finalizeInvoice((await createDraftInvoice(orgId, invoiceInput())).id, { now: ISSUE });
    await expect(buildTakeOverPrefill(otherOrg.id, finalized.id, { lines: true, texts: false, terms: false, prices: false })).rejects.toBeInstanceOf(NotFoundError);
  });
});
