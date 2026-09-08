/**
 * Phase 12e, Task 3 — statusCounts und paymentBehaviour. Eigenes Jahr 2086
 * (Testjahr-Konvention), eigener Nummernkreis-Praefix. Alle Tagesgrenzen UTC.
 * Faelle nach Lastenheft §54: Grenzfall "am Faelligkeitstag bezahlt" gilt als puenktlich,
 * Division durch Null bei null Zahlungen liefert null statt NaN.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { statusCounts } from "@/domain/reporting/status";
import { paymentBehaviour } from "@/domain/reporting/payment-behaviour";
import type { CreateInvoiceInput } from "@/schemas";

const ISSUE = new Date(Date.UTC(2086, 2, 1, 10, 0, 0));
const NOW = new Date(Date.UTC(2086, 3, 20, 10, 0, 0));
let orgId: string;
let customerId: string;

function line(netCents: number) {
  return { description: "Leistung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: netCents, taxRate: 0 as const, taxCategory: "Z" as const, discountPermille: 0 };
}

/** Rechnung mit Faelligkeit anlegen, festschreiben, optional voll bezahlen. */
async function make(netCents: number, due: Date, paidAt?: Date) {
  const inv = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "KLEINUNTERNEHMER", currency: "EUR", issueDate: ISSUE, notes: "Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer", lines: [line(netCents)] } as CreateInvoiceInput, { now: ISSUE });
  await dbInternal.invoice.update({ where: { id: inv.id }, data: { dueDate: due } });
  await finalizeInvoice(inv.id, { now: ISSUE });
  if (paidAt) await recordPayment(inv.id, { amountCents: netCents, paidAt, method: "TRANSFER", isSkonto: false, applySkonto: false }, { orgId });
  return inv;
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Verhalten Test GmbH", addressLine1: "Zahlweg 1", postalCode: "10115", city: "Berlin", vatId: "DE866666666", taxNumber: "86/666/66666", smallBusiness: true },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  customerId = (await dbInternal.customer.create({ data: { orgId, name: "Zahlkunde AG", addressLine1: "Z 1", postalCode: "10117", city: "Berlin", type: "BUSINESS" } })).id;

  await make(10000, new Date(Date.UTC(2086, 2, 15)), new Date(Date.UTC(2086, 2, 12))); // puenktlich, 11 Tage
  await make(20000, new Date(Date.UTC(2086, 2, 15)), new Date(Date.UTC(2086, 2, 25))); // 10 Tage zu spaet, 24 Tage
  await make(30000, new Date(Date.UTC(2086, 3, 10)));                                   // offen -> OVERDUE zu NOW
});

describe("statusCounts", () => {
  it("zaehlt je effektivem Status, liefert offenen Betrag, deutsche Labels, keine leeren Eintraege", async () => {
    const rows = await statusCounts(orgId, NOW);
    expect(rows.every((r) => r.count > 0)).toBe(true);
    expect(rows.find((r) => r.status === "PAID")).toMatchObject({ count: 2, openCents: 0 });
    expect(rows.find((r) => r.status === "OVERDUE")).toMatchObject({ count: 1, openCents: 30000, label: "Überfällig" });
  });
});

describe("paymentBehaviour", () => {
  it("mittelt die Tage bis zur Zahlung und den Puenktlichkeitsanteil", async () => {
    const b = await paymentBehaviour(orgId, { customerId });
    expect(b.paidCount).toBe(2);
    expect(b.avgDaysToPay).toBe(18);      // (11 + 24) / 2 = 17,5 -> kaufmaennisch 18
    expect(b.onTimeShare).toBe(0.5);
  });
  it("ohne bezahlte Rechnung: null statt NaN", async () => {
    const other = await dbInternal.organization.create({ data: { legalName: "Ohne Zahlung GmbH", addressLine1: "O 1", postalCode: "10115", city: "Berlin" } });
    expect(await paymentBehaviour(other.id)).toEqual({ paidCount: 0, avgDaysToPay: null, onTimeShare: null });
  });
  it("am Faelligkeitstag bezahlt gilt als puenktlich", async () => {
    await make(5000, new Date(Date.UTC(2086, 2, 20)), new Date(Date.UTC(2086, 2, 20)));
    const b = await paymentBehaviour(orgId, { customerId });
    expect(b.paidCount).toBe(3);
    expect(b.onTimeShare).toBeCloseTo(2 / 3, 5);
  });
});
