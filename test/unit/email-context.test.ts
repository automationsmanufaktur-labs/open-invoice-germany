import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { buildTemplateContext, DocumentNotFoundError } from "@/domain/email/context";
import { buildStandardAttachments } from "@/domain/email/attachments";
import type { CreateInvoiceInput } from "@/schemas";

let orgId: string;
let otherOrgId: string;
let customerId: string;
const FIX_DATE = new Date("2029-06-09T10:00:00.000Z"); // eigenes Jahr, um Nummernkreis-Kollisionen mit anderen Testdateien zu vermeiden

function baseInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: new Date("2026-06-01"),
    lines: [
      { description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 },
    ],
    ...extra,
  } as CreateInvoiceInput;
}

/** Prueft rekursiv, dass kein Schluessel "internalNotes" im Kontext auftaucht. */
function assertNoInternalNotes(value: unknown, path = "ctx"): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    expect(key).not.toBe("internalNotes");
    assertNoInternalNotes(v, `${path}.${key}`);
  }
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Kontext-Test GmbH",
      addressLine1: "Teststr. 2",
      postalCode: "10115",
      city: "Berlin",
      email: "buero@kontext-test.example",
      iban: "DE12500105170648489890",
      bic: "INGDDEFFXXX",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
    },
  });
  orgId = org.id;

  const other = await dbInternal.organization.create({
    data: { legalName: "Fremd GmbH", addressLine1: "Fremdweg 1", postalCode: "99999", city: "Nirgendwo" },
  });
  otherOrgId = other.id;

  const customer = await dbInternal.customer.create({
    data: {
      orgId,
      name: "Kunde AG",
      contactName: "Erika Musterfrau",
      addressLine1: "Marktplatz 2",
      postalCode: "20095",
      city: "Hamburg",
      type: "BUSINESS",
      email: "einkauf@kunde-ag.example",
      leitwegId: "04011000-12345-67",
    },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

describe("buildTemplateContext / buildStandardAttachments — Rechnung", () => {
  it("Entwurf: Kontext korrekt, Anhang ist das ENTWURF-PDF, interne Notiz taucht nicht auf", async () => {
    const draft = await createDraftInvoice(orgId, baseInput({ internalNotes: "Streng vertrauliche interne Notiz" }));

    const { ctx, customerEmail, docNumber } = await buildTemplateContext(orgId, "INVOICE", draft.id);
    expect(docNumber).toBe("ENTWURF");
    expect(customerEmail).toBe("einkauf@kunde-ag.example");
    const document = ctx.document as { number: string; total: string };
    expect(document.number).toBe("");
    expect(document.total.endsWith(" €")).toBe(true);
    assertNoInternalNotes(ctx);

    const attachments = await buildStandardAttachments(orgId, "INVOICE", draft.id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toMatch(/-ENTWURF\.pdf$/);
    expect(attachments[0]!.content.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("festgeschrieben mit Leitweg-ID: PDF + XRechnung-XML, Kontext mit Rechnungsnummer", async () => {
    const draft = await createDraftInvoice(orgId, baseInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const { ctx, docNumber } = await buildTemplateContext(orgId, "INVOICE", finalized.id);
    expect(docNumber).toBe(finalized.number);
    const document = ctx.document as { number: string; total: string };
    expect(document.number).toBe(finalized.number);
    expect(document.total.endsWith(" €")).toBe(true);
    assertNoInternalNotes(ctx);

    const attachments = await buildStandardAttachments(orgId, "INVOICE", finalized.id);
    expect(attachments).toHaveLength(2);
    const pdf = attachments.find((a) => a.filename.endsWith(".pdf"))!;
    const xml = attachments.find((a) => a.filename.endsWith(".xml"))!;
    expect(pdf.filename).toBe(`${finalized.number}.pdf`);
    expect(pdf.content.subarray(0, 4).toString()).toBe("%PDF");
    expect(xml.filename).toBe(`${finalized.number}-xrechnung.xml`);
    expect(xml.content.subarray(0, 5).toString()).toBe("<?xml");
  });

  it("Kunde ohne Leitweg-ID: nur PDF, keine XRechnung", async () => {
    const customerOhneLeitweg = await dbInternal.customer.create({
      data: { orgId, name: "Kunde ohne Leitweg", addressLine1: "Weg 1", postalCode: "10000", city: "Berlin", type: "BUSINESS", email: "ohne@example.com" },
    });
    const draft = await createDraftInvoice(orgId, baseInput({ customerId: customerOhneLeitweg.id }));
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const attachments = await buildStandardAttachments(orgId, "INVOICE", finalized.id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename.endsWith(".pdf")).toBe(true);
  });

  it("fremde orgId: DocumentNotFoundError im Kontext, leeres Array bei Anhaengen", async () => {
    const draft = await createDraftInvoice(orgId, baseInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await expect(buildTemplateContext(otherOrgId, "INVOICE", finalized.id)).rejects.toBeInstanceOf(DocumentNotFoundError);
    const attachments = await buildStandardAttachments(otherOrgId, "INVOICE", finalized.id);
    expect(attachments).toEqual([]);
  });

  it("Belegtyp-Abgleich: eine echte Rechnung wird nicht als CREDIT_NOTE angeboten", async () => {
    const draft = await createDraftInvoice(orgId, baseInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await expect(buildTemplateContext(orgId, "CREDIT_NOTE", finalized.id)).rejects.toBeInstanceOf(DocumentNotFoundError);
    const attachments = await buildStandardAttachments(orgId, "CREDIT_NOTE", finalized.id);
    expect(attachments).toEqual([]);
  });

  it("XRechnung-Anhang folgt dem Kaeufer-Snapshot, nicht dem aktuellen Kundenstamm", async () => {
    const customerOhneLeitweg = await dbInternal.customer.create({
      data: { orgId, name: "Snapshot-Kunde ohne Leitweg", addressLine1: "Weg 2", postalCode: "10000", city: "Berlin", type: "BUSINESS", email: "snap1@example.com" },
    });
    const draftOhne = await createDraftInvoice(orgId, baseInput({ customerId: customerOhneLeitweg.id }));
    const finalizedOhne = await finalizeInvoice(draftOhne.id, { now: FIX_DATE });
    // Leitweg-ID wird NACH Festschreibung am Stamm ergaenzt -> darf den Anhang nicht aendern.
    await dbInternal.customer.update({ where: { id: customerOhneLeitweg.id }, data: { leitwegId: "04011000-99999-99" } });
    const attachmentsOhne = await buildStandardAttachments(orgId, "INVOICE", finalizedOhne.id);
    expect(attachmentsOhne).toHaveLength(1);
    expect(attachmentsOhne[0]!.filename.endsWith(".pdf")).toBe(true);

    const customerMitLeitweg = await dbInternal.customer.create({
      data: { orgId, name: "Snapshot-Kunde mit Leitweg", addressLine1: "Weg 3", postalCode: "10000", city: "Berlin", type: "BUSINESS", email: "snap2@example.com", leitwegId: "04011000-11111-11" },
    });
    const draftMit = await createDraftInvoice(orgId, baseInput({ customerId: customerMitLeitweg.id }));
    const finalizedMit = await finalizeInvoice(draftMit.id, { now: FIX_DATE });
    // Leitweg-ID wird NACH Festschreibung wieder entfernt -> Anhang bleibt trotzdem dabei.
    await dbInternal.customer.update({ where: { id: customerMitLeitweg.id }, data: { leitwegId: null } });
    const attachmentsMit = await buildStandardAttachments(orgId, "INVOICE", finalizedMit.id);
    expect(attachmentsMit).toHaveLength(2);
    expect(attachmentsMit.some((a) => a.filename.endsWith("-xrechnung.xml"))).toBe(true);
  });

  it("stornierte Rechnung liefert weiterhin das ZUGFeRD-PDF, kein ENTWURF-Anhang", async () => {
    const draft = await createDraftInvoice(orgId, baseInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const cancelled = await cancelInvoice(finalized.id, { now: FIX_DATE });

    const attachments = await buildStandardAttachments(orgId, "INVOICE", cancelled.originalId);
    expect(attachments.length).toBeGreaterThanOrEqual(1);
    const pdf = attachments.find((a) => a.filename.endsWith(".pdf"))!;
    expect(pdf.filename).toBe(`${cancelled.originalNumber}.pdf`);
    expect(pdf.filename).not.toMatch(/ENTWURF/);
    expect(pdf.content.subarray(0, 4).toString()).toBe("%PDF");
  });
});
