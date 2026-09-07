/**
 * Phase 8b, Task 3 — ActivityLog-Schreiber (`logActivity`) an den in Brief/Facts
 * genannten Domain-Aufrufstellen + `buildTimeline` (Reihenfolge/Meilensteine).
 *
 * Testjahr 2065 (Plan-Header). EIN gemeinsamer Org fuer die gesamte Datei (Muster
 * dunning-engine.test.ts) — `Invoice.number` ist global eindeutig, mehrere Orgs im
 * selben Jahr wuerden bei der ersten Rechnung kollidieren (Sequenz startet je Org bei 1).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { updateDraftInvoice } from "@/domain/invoice/update";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { createPartialCreditNote } from "@/domain/invoice/credit";
import { createDunning } from "@/domain/dunning/create";
import { sendDunning } from "@/domain/dunning/send";
import { setDunningState } from "@/domain/dunning/state";
import { createBusinessDocument } from "@/domain/document/create";
import { setQuoteStatus, setDeliveryNoteStatus } from "@/domain/document/status";
import { convertDocument } from "@/domain/document/convert";
import { duplicateDocument } from "@/domain/document/duplicate";
import { buildTakeOverPrefill } from "@/domain/document/take-over";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { addAttachment, removeAttachment } from "@/domain/attachment/manage";
import { createShareLink } from "@/domain/quote-share/link";
import { sendDocumentEmail } from "@/domain/email/send";
import { saveMailSettings } from "@/domain/email/settings";
import { createMemoryProvider } from "@/lib/mail/memory";
import { buildTimeline } from "@/domain/timeline/build";
import { createInvoiceSchema, type CreateInvoiceInput, type CreateDocumentInput } from "@/schemas";

const FIX_DATE = new Date("2065-06-09T10:00:00.000Z");
const PDF_BYTES = Buffer.from("%PDF-1.7\nInhalt\n");

let orgId: string;
let customerId: string;
let n = 0;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oig-activity-int-"));
  process.env.ATTACHMENTS_DIR = tmpDir;
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: { legalName: "Activity Test GmbH", addressLine1: "Teststr. 1", postalCode: "12345", city: "Berlin", vatId: "DE999999998", taxNumber: "1" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Activity Test GmbH",
    fromEmail: "rechnung@example.org",
    defaultCc: "",
    defaultBcc: "",
    copyToSelf: false,
  });

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde@example.org" },
  });
  customerId = customer.id;
});

async function activityRows(entityType: string, entityId: string) {
  return dbInternal.activityLog.findMany({ where: { orgId, entityType, entityId }, orderBy: { at: "asc" } });
}

function invoiceInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  n += 1;
  return createInvoiceSchema.parse({
    customerId,
    deliveryDate: new Date("2065-06-01"),
    dueDate: new Date("2065-06-01"),
    lines: [{ description: `Position ${n}`, quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }],
    ...extra,
  } as CreateInvoiceInput);
}

describe("logActivity an den Domain-Aufrufstellen (Task-3-Brief)", () => {
  it("CREATE/UPDATE/FINALIZE einer Rechnung schreiben CREATED/UPDATED/FINALIZED", async () => {
    // updateDraftInvoice nimmt kein injizierbares `now` entgegen (nutzt real `new Date()`)
    // — die Reihenfolge nach `at` ist deshalb hier NICHT verlaesslich pruefbar (FIX_DATE
    // liegt bewusst in der Zukunft, 2065), nur die Menge der geschriebenen Typen.
    const invoice = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    let rows = await activityRows("INVOICE", invoice.id);
    expect(rows.map((r) => r.type)).toEqual(["CREATED"]);

    await updateDraftInvoice(orgId, invoice.id, { subject: "Geaendert" }, "tester");
    rows = await activityRows("INVOICE", invoice.id);
    expect(rows.map((r) => r.type).sort()).toEqual(["CREATED", "UPDATED"].sort());

    await finalizeInvoice(invoice.id, { now: FIX_DATE });
    rows = await activityRows("INVOICE", invoice.id);
    expect(rows.map((r) => r.type).sort()).toEqual(["CREATED", "FINALIZED", "UPDATED"].sort());
  });

  it("recordPayment schreibt PAYMENT_RECORDED", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await recordPayment(finalized.id, { amountCents: finalized.grossTotalCents, method: "TRANSFER", isSkonto: false, applySkonto: false }, { now: FIX_DATE });

    const rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("PAYMENT_RECORDED");
  });

  it("cancelInvoice schreibt CANCELLED", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await cancelInvoice(finalized.id, { now: FIX_DATE });

    const rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("CANCELLED");
  });

  it("createPartialCreditNote schreibt CREDIT_NOTE_CREATED", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await createPartialCreditNote(finalized.id, { lines: [{ description: "Teilgutschrift", quantityMilli: 1000, unitNetPriceCents: 1000, taxRate: 19, taxCategory: "S" }] }, { now: FIX_DATE });

    const rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("CREDIT_NOTE_CREATED");
  });

  it("Mahnungs-Zyklus schreibt DUNNING_CREATED, DUNNING_SENT, DUNNING_STATE", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2065-06-01") }), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const { dunning } = await createDunning(finalized.id, { now: FIX_DATE }); // 8 Tage nach dueDate > 3 Tage Stufe 0
    let rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("DUNNING_CREATED");

    const provider = createMemoryProvider();
    await sendDunning(orgId, dunning.id, { actor: "tester", provider });
    rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("DUNNING_SENT");

    await setDunningState(orgId, finalized.id, { state: "PAUSED", pausedUntil: "2065-12-31" }, "tester");
    rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("DUNNING_STATE");
  });

  it("sendDocumentEmail schreibt SENT (Rechnung + EmailLog-Statuswechsel)", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const provider = createMemoryProvider();

    const result = await sendDocumentEmail(
      orgId,
      "tester",
      {
        docType: "INVOICE",
        docId: finalized.id,
        to: "kunde@example.org",
        cc: "",
        bcc: "",
        subject: "Ihre Rechnung",
        body: "Text",
        signature: "",
        copyToSelf: false,
        standardAttachments: [],
        warnings: [],
      },
      [],
      provider,
    );
    expect(result.status).toBe("SENT");

    const rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("SENT");
  });

  it("convertDocument (Angebot -> Rechnung) schreibt CONVERTED am Quelldokument", async () => {
    const quote = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }] } as CreateDocumentInput,
      { now: FIX_DATE },
    );

    await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "INVOICE" }, { now: FIX_DATE });

    const rows = await activityRows("QUOTE", quote.id);
    expect(rows.map((r) => r.type)).toContain("CONVERTED");
  });

  it("duplicateDocument (Rechnung) schreibt DUPLICATED an der Kopie", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });

    const dup = await duplicateDocument(orgId, "INVOICE", draft.id, "tester", FIX_DATE);

    const rows = await activityRows("INVOICE", dup.id);
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(["CREATED", "DUPLICATED"]));
  });

  it("addAttachment/removeAttachment schreiben ATTACHMENT_ADDED/ATTACHMENT_REMOVED", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });

    const att = await addAttachment(orgId, "INVOICE", draft.id, { filename: "beleg.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    let rows = await activityRows("INVOICE", draft.id);
    expect(rows.map((r) => r.type)).toContain("ATTACHMENT_ADDED");

    await removeAttachment(orgId, "INVOICE", draft.id, att.id, "tester");
    rows = await activityRows("INVOICE", draft.id);
    expect(rows.map((r) => r.type)).toContain("ATTACHMENT_REMOVED");
  });

  it("setQuoteStatus (ACCEPTED/REJECTED) und createShareLink schreiben QUOTE_ACCEPTED/QUOTE_REJECTED/SHARE_LINK_CREATED", async () => {
    const accepted = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }] } as CreateDocumentInput,
      { now: FIX_DATE },
    );
    await createShareLink(orgId, accepted.id, {}, { now: FIX_DATE });
    let rows = await activityRows("QUOTE", accepted.id);
    expect(rows.map((r) => r.type)).toContain("SHARE_LINK_CREATED");

    await setQuoteStatus(orgId, accepted.id, "ACCEPTED", { now: FIX_DATE });
    rows = await activityRows("QUOTE", accepted.id);
    expect(rows.map((r) => r.type)).toContain("QUOTE_ACCEPTED");

    const rejected = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }] } as CreateDocumentInput,
      { now: FIX_DATE },
    );
    await setQuoteStatus(orgId, rejected.id, "REJECTED", { now: FIX_DATE });
    rows = await activityRows("QUOTE", rejected.id);
    expect(rows.map((r) => r.type)).toContain("QUOTE_REJECTED");
  });

  it("setDeliveryNoteStatus schreibt SENT/DELIVERED", async () => {
    const note = await createDeliveryNote(orgId, { customerId, lines: [{ description: "Ware", quantityMilli: 1000, unitNetPriceCents: 0, taxRate: 19 }] }, { now: FIX_DATE });

    await setDeliveryNoteStatus(orgId, note.id, "SENT", { now: FIX_DATE });
    let rows = await activityRows("DELIVERY_NOTE", note.id);
    expect(rows.map((r) => r.type)).toContain("SENT");

    await setDeliveryNoteStatus(orgId, note.id, "DELIVERED", { now: FIX_DATE });
    rows = await activityRows("DELIVERY_NOTE", note.id);
    expect(rows.map((r) => r.type)).toContain("DELIVERED");
  });

  it("buildTakeOverPrefill schreibt TAKEN_OVER am Quellbeleg (rein lesend)", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await buildTakeOverPrefill(orgId, finalized.id, { lines: true, texts: false, terms: false, prices: false }, "tester");

    const rows = await activityRows("INVOICE", finalized.id);
    expect(rows.map((r) => r.type)).toContain("TAKEN_OVER");
  });

  it("logActivity wirft nie — ein DB-Fehler beim Protokollieren bricht das Ereignis nicht ab", async () => {
    // buildTakeOverPrefill ruft logActivity AUSSERHALB einer Transaktion mit `dbInternal`
    // auf (Modulkommentar take-over.ts) — ein Mock auf `dbInternal.activityLog.create`
    // greift dort direkt (anders als bei den `tx`-Aufrufstellen innerhalb einer
    // Transaktion, die einen eigenen, von Prisma pro Aufruf erzeugten Client-Proxy nutzen).
    const draft = await createDraftInvoice(orgId, invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const spy = vi.spyOn(dbInternal.activityLog, "create").mockRejectedValueOnce(new Error("DB kaputt"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const prefill = await buildTakeOverPrefill(orgId, finalized.id, { lines: true, texts: false, terms: false, prices: false }, "tester");
    expect(prefill.lines).toBeDefined();
    expect(errSpy).toHaveBeenCalled();

    spy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("buildTimeline — Reihenfolge + Meilensteine", () => {
  it("mischt ActivityLog/EmailLog/Payment/Dunning aufsteigend und markiert Meilensteine", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date("2065-06-01") }), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const provider = createMemoryProvider();
    await sendDocumentEmail(
      orgId,
      "tester",
      {
        docType: "INVOICE",
        docId: finalized.id,
        to: "kunde@example.org",
        cc: "",
        bcc: "",
        subject: "Ihre Rechnung",
        body: "Text",
        signature: "",
        copyToSelf: false,
        standardAttachments: [],
        warnings: [],
      },
      [],
      provider,
    );

    await recordPayment(finalized.id, { amountCents: 5000, method: "TRANSFER", isSkonto: false, applySkonto: false }, { now: new Date("2065-06-05T10:00:00.000Z") });
    await createDunning(finalized.id, { now: FIX_DATE });

    const timeline = await buildTimeline(orgId, { kind: "INVOICE", id: finalized.id }, FIX_DATE);

    // aufsteigend sortiert
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].at.getTime()).toBeGreaterThanOrEqual(timeline[i - 1].at.getTime());
    }

    const kinds = timeline.map((e) => e.kind);
    expect(kinds).toContain("activity");
    expect(kinds).toContain("email");
    expect(kinds).toContain("payment");
    expect(kinds).toContain("dunning");
    expect(kinds).toContain("milestone");

    // Zahlungsziel erreicht (dueDate 2065-06-01 <= FIX_DATE 2065-06-09, nicht PAID)
    expect(timeline.some((e) => e.label === "Zahlungsziel erreicht")).toBe(true);
  });

  // Fix-Welle (Nit): der Zahlungs-Eintrag hardcodete "EUR" unabhaengig von Invoice.currency.
  it("Zahlungs-Eintrag zeigt die tatsaechliche Waehrung des Belegs, nicht hartkodiert EUR", async () => {
    const draft = await createDraftInvoice(orgId, invoiceInput({ currency: "USD", dueDate: new Date("2065-06-01") }), { now: FIX_DATE });
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    await recordPayment(finalized.id, { amountCents: 5000, method: "TRANSFER", isSkonto: false, applySkonto: false }, { now: new Date("2065-06-05T10:00:00.000Z") });

    const timeline = await buildTimeline(orgId, { kind: "INVOICE", id: finalized.id }, FIX_DATE);
    const paymentEntry = timeline.find((e) => e.kind === "payment");
    expect(paymentEntry?.detail).toContain("$");
    expect(paymentEntry?.detail).not.toContain("EUR");
  });

  it("markiert ein Angebot als abgelaufen, wenn validUntil in der Vergangenheit liegt", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        validUntil: new Date("2065-06-01"),
        lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }],
      } as CreateDocumentInput,
      { now: FIX_DATE },
    );

    const timeline = await buildTimeline(orgId, { kind: "QUOTE", id: quote.id }, FIX_DATE);
    expect(timeline.some((e) => e.label === "Angebot abgelaufen")).toBe(true);
  });
});
