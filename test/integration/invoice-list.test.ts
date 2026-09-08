/**
 * Rechnungsliste: Filter/Suche/Paginierung (Phase 8b, §40).
 *
 * Eigenes Jahr (2063) fuer die Nummernvergabe — "Invoice.number" ist global @unique
 * und test.db wird ueber die gesamte Testlaufzeit geteilt (siehe Kommentar in
 * phase1.test.ts / payment-skonto.test.ts).
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { listInvoices } from "@/domain/invoice/list";
import { recordPaymentSchema, type CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
let otherCustomerId: string;

// Fix-Welle (S7): UTC — effectiveInvoiceStatus/listInvoices vergleichen tagesgenau in
// UTC (utcDateOnly, siehe src/lib/date-only.ts), nicht mehr lokal.
const NOW = new Date(Date.UTC(2063, 5, 15, 10, 0, 0));
const TODAY = new Date(Date.UTC(2063, 5, 15));
const YESTERDAY = new Date(Date.UTC(2063, 5, 14));
const IN_10_DAYS = new Date(Date.UTC(2063, 5, 25));

const ids: Record<string, string> = {};

function line(description: string, extra: Partial<CreateInvoiceInput["lines"][number]> = {}) {
  return {
    description,
    quantityMilli: 1000,
    unit: "HUR" as const,
    unitNetPriceCents: 10000,
    taxRate: 19 as const,
    taxCategory: "S" as const,
    discountPermille: 0,
    ...extra,
  };
}

async function draftInvoice(description: string, opts: { customerId?: string } = {}) {
  const input: CreateInvoiceInput = {
    customerId: opts.customerId ?? customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    issueDate: NOW,
    lines: [line(description)],
  } as CreateInvoiceInput;
  return createDraftInvoice(orgId, input, { now: NOW });
}

async function finalizedInvoice(description: string, dueDate: Date, opts: { customerId?: string } = {}) {
  const draft = await draftInvoice(description, opts);
  await dbInternal.invoice.update({ where: { id: draft.id }, data: { dueDate } });
  return finalizeInvoice(draft.id, { now: NOW });
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Listen Test GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "21339",
      city: "Lüneburg",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
    },
  });
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  const other = await dbInternal.customer.create({
    data: { orgId, name: "Andere GmbH", addressLine1: "Nebenweg 3", postalCode: "20099", city: "Hamburg", type: "BUSINESS" },
  });
  otherCustomerId = other.id;
  await ensureOrgMasterdata(dbInternal, orgId);

  // 1) Entwurf
  const draft = await draftInvoice("Sonderberatung Alphaprojekt");
  ids.draft = draft.id;

  // 2) offen (dueDate in 10 Tagen)
  const open = await finalizedInvoice("Regelmaessige Wartung", IN_10_DAYS, { customerId: otherCustomerId });
  ids.open = open.id;

  // 3) faellig heute
  const due = await finalizedInvoice("Beratung Standardvertrag", TODAY);
  ids.due = due.id;

  // 4) ueberfaellig (dueDate gestern)
  const overdue = await finalizedInvoice("Beratung Standardvertrag", YESTERDAY);
  ids.overdue = overdue.id;

  // 5) teilbezahlt
  const partial = await finalizedInvoice("Beratung Standardvertrag", YESTERDAY);
  ids.partial = partial.id;
  await recordPayment(partial.id, recordPaymentSchema.parse({ amountCents: 1000, method: "TRANSFER", paidAt: NOW }));

  // 6) bezahlt (voller Betrag: 1 * 100,00 EUR netto, 19% -> 119,00 EUR brutto = 11900 Cent)
  const paid = await finalizedInvoice("Beratung Standardvertrag", YESTERDAY);
  ids.paid = paid.id;
  await recordPayment(paid.id, recordPaymentSchema.parse({ amountCents: 11900, method: "TRANSFER", paidAt: NOW }));
});

describe("listInvoices: Status-Filter", () => {
  it("all: alle sechs Fixtures dieser Organisation", async () => {
    const result = await listInvoices(orgId, { limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    for (const id of Object.values(ids)) expect(returnedIds).toContain(id);
    expect(result.total).toBeGreaterThanOrEqual(6);
    // Fix-Welle (Nit): dunningCount steuert in RowActionsMenu, ob "Zahlungserinnerung
    // senden" oder "Nächste Mahnung erstellen" angezeigt wird — keine der Fixtures hier
    // hat eine Mahnung erhalten.
    for (const r of result.rows) expect(r.dunningCount).toBe(0);
  });

  it("draft: nur der Entwurf", async () => {
    const result = await listInvoices(orgId, { status: "draft", limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds).toContain(ids.draft);
    expect(returnedIds).not.toContain(ids.open);
    expect(returnedIds).not.toContain(ids.due);
    expect(returnedIds).not.toContain(ids.overdue);
    for (const r of result.rows) expect(r.effectiveStatus).toBe("DRAFT");
  });

  it("open: nur die offene Rechnung (dueDate in der Zukunft)", async () => {
    const result = await listInvoices(orgId, { status: "open", limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds).toContain(ids.open);
    expect(returnedIds).not.toContain(ids.due);
    expect(returnedIds).not.toContain(ids.overdue);
    expect(returnedIds).not.toContain(ids.draft);
    for (const r of result.rows) expect(r.effectiveStatus).toBe("OPEN");
  });

  it("due: nur die heute faellige Rechnung", async () => {
    const result = await listInvoices(orgId, { status: "due", limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds).toEqual([ids.due]);
    expect(result.rows[0].effectiveStatus).toBe("DUE");
  });

  // Fix-Welle (S1, Ruling): "overdue" schliesst jetzt auch teilbezahlte Rechnungen mit
  // Restbetrag ein — `partial` (dueDate gestern, teilweise bezahlt) ist ebenfalls
  // ueberfaellig und darf nicht mehr aus dem Filter verschwinden (der eigentliche Bug:
  // eine teilbezahlte ueberfaellige Rechnung war vorher aus JEDER faellig/ueberfaellig-
  // Ableitung ausgeschlossen).
  it("overdue: die ueberfaellige UND die teilbezahlte ueberfaellige Rechnung", async () => {
    const result = await listInvoices(orgId, { status: "overdue", limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds.sort()).toEqual([ids.overdue, ids.partial].sort());
    for (const r of result.rows) expect(r.effectiveStatus).toBe("OVERDUE");
    const partialRow = result.rows.find((r) => r.id === ids.partial);
    expect(partialRow!.partiallyPaid).toBe(true);
  });

  it("partial: nur die teilbezahlte Rechnung", async () => {
    const result = await listInvoices(orgId, { status: "partial", limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds).toEqual([ids.partial]);
    expect(result.rows[0].openCents).toBeGreaterThan(0);
    expect(result.rows[0].paidAmountCents).toBe(1000);
  });

  it("paid: nur die vollstaendig bezahlte Rechnung", async () => {
    const result = await listInvoices(orgId, { status: "paid", limit: 200 }, NOW);
    const returnedIds = result.rows.map((r) => r.id);
    expect(returnedIds).toEqual([ids.paid]);
    expect(result.rows[0].openCents).toBe(0);
  });
});

describe("listInvoices: weitere Filter", () => {
  it("customerId: filtert auf den zweiten Kunden", async () => {
    const result = await listInvoices(orgId, { customerId: otherCustomerId, limit: 200 }, NOW);
    expect(result.rows.every((r) => r.customerId === otherCustomerId)).toBe(true);
    expect(result.rows.map((r) => r.id)).toContain(ids.open);
  });

  it("q: Volltext auf Positionstext findet nur die passende Rechnung", async () => {
    const result = await listInvoices(orgId, { q: "Alphaprojekt", limit: 200 }, NOW);
    expect(result.rows.map((r) => r.id)).toEqual([ids.draft]);
  });

  it("q kombiniert mit status=open liefert kein falsches Ergebnis (OR-Kollision)", async () => {
    // Regressionstest: status=open traegt selbst ein OR (dueDate null/ab morgen) — ein
    // zweites OR fuer q darf das nicht ueberschreiben.
    const result = await listInvoices(orgId, { status: "open", q: "Wartung", limit: 200 }, NOW);
    expect(result.rows.map((r) => r.id)).toEqual([ids.open]);

    const noMatch = await listInvoices(orgId, { status: "open", q: "Alphaprojekt", limit: 200 }, NOW);
    expect(noMatch.rows).toEqual([]);
  });

  it("Paginierung: limit/offset mit korrektem total", async () => {
    const all = await listInvoices(orgId, { limit: 200 }, NOW);
    const total = all.total;
    const page1 = await listInvoices(orgId, { limit: 2, offset: 0 }, NOW);
    const page2 = await listInvoices(orgId, { limit: 2, offset: 2 }, NOW);
    expect(page1.total).toBe(total);
    expect(page2.total).toBe(total);
    expect(page1.rows.length).toBe(2);
    expect(page2.rows.length).toBe(2);
    expect(page1.rows.map((r) => r.id)).not.toEqual(page2.rows.map((r) => r.id));
  });
});
