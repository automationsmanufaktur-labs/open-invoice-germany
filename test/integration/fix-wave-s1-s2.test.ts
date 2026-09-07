/**
 * Fix-Welle Phase 8b (final-review-findings.md S1 + S2) — gezielte Integrationstests fuer
 * die beiden finanziell relevanten Befunde:
 *
 * S1: eine teilweise bezahlte, ueberfaellige Rechnung darf nicht aus jeder faellig/
 * ueberfaellig-Ableitung verschwinden (Kundenuebersicht, Listenfilter, Mahn-Aktionsmatrix).
 * S2: Umsatz-Kennzahlen (Dashboard, Kunde) duerfen eine Abschlagskette (§14) nicht doppelt
 * zaehlen (payableBaseCents statt grossTotalCents).
 *
 * Eigenes Jahr 2069 (Testjahr-Konvention, plan-header.md).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { createBusinessDocument } from "@/domain/document/create";
import { createDownpaymentInvoice } from "@/domain/invoice/downpayment";
import { createFinalInvoice } from "@/domain/invoice/final";
import { listInvoices } from "@/domain/invoice/list";
import { customerOverview } from "@/domain/customer/overview";
import { dashboardSummary } from "@/domain/dashboard/summary";
import { availableActions } from "@/domain/document/actions";
import type { CreateInvoiceInput, CreateDocumentInput } from "@/schemas";

const NOW = new Date(Date.UTC(2069, 5, 15, 10, 0, 0));
const PAST_10 = new Date(Date.UTC(2069, 5, 5, 10, 0, 0));

function zeroTaxLine(description: string, netCents: number) {
  return {
    description,
    quantityMilli: 1000,
    unit: "C62" as const,
    unitNetPriceCents: netCents,
    taxRate: 0 as const,
    taxCategory: "Z" as const,
    discountPermille: 0,
  };
}

describe("S1: halb bezahlte, ueberfaellige Rechnung bleibt faellig/ueberfaellig sichtbar", () => {
  let orgId: string;
  let customerId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "S1 Fix-Welle GmbH", addressLine1: "S1weg 1", postalCode: "10115", city: "Berlin", vatId: "DE111111111", taxNumber: "11/111/11111" },
    });
    orgId = org.id;
    await ensureOrgMasterdata(dbInternal, orgId);
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "S1 Kunde AG", addressLine1: "Marktplatz 1", postalCode: "10117", city: "Berlin", type: "BUSINESS" },
    });
    customerId = customer.id;

    // 10.000,00 EUR netto/brutto (taxRate 0 fuer runde Cent-Betraege), faellig vor 10 Tagen.
    const draft = await createDraftInvoice(
      orgId,
      { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: PAST_10, dueDate: PAST_10, lines: [zeroTaxLine("Beratung", 1_000_000)] } as CreateInvoiceInput,
      { now: PAST_10 },
    );
    invoiceId = draft.id;
    await finalizeInvoice(invoiceId, { now: PAST_10 });
    // Haelfte bezahlt -> Restbetrag 5.000,00 EUR offen, Status PARTIALLY_PAID.
    await recordPayment(invoiceId, { amountCents: 500_000, paidAt: NOW, method: "TRANSFER", isSkonto: false, applySkonto: false });
  });

  it("Listenfilter status=overdue enthaelt die teilbezahlte Rechnung mit offenem Restbetrag 5.000,00 EUR", async () => {
    const result = await listInvoices(orgId, { status: "overdue" }, NOW);
    const row = result.rows.find((r) => r.id === invoiceId);
    expect(row).toBeDefined();
    expect(row!.effectiveStatus).toBe("OVERDUE");
    expect(row!.partiallyPaid).toBe(true);
    expect(row!.openCents).toBe(500_000);
  });

  it("customerOverview meldet 5.000,00 EUR offen UND 5.000,00 EUR ueberfaellig statt 0 €", async () => {
    const overview = await customerOverview(orgId, customerId, NOW);
    expect(overview.kpis.openCents).toBe(500_000);
    expect(overview.kpis.overdueCents).toBe(500_000);
  });

  it("REMINDER/DUNNING sind fuer die teilbezahlte ueberfaellige Rechnung verfuegbar (dunningState ACTIVE)", async () => {
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const actions = availableActions({
      kind: "INVOICE",
      type: "INVOICE",
      status: "OVERDUE",
      isDraft: false,
      dunningState: invoice.dunningState as "ACTIVE" | "PAUSED" | "STOPPED",
    });
    expect(actions).toContain("REMINDER");
    expect(actions).toContain("DUNNING");
  });

  it("dashboardSummary zaehlt die teilbezahlte ueberfaellige Rechnung unter overdueInvoices", async () => {
    const summary = await dashboardSummary(orgId, NOW);
    expect(summary.overdueInvoices.count).toBe(1);
    expect(summary.overdueInvoices.cents).toBe(500_000);
  });
});

describe("S2: Umsatz-KPIs zaehlen eine Abschlagskette nicht doppelt (payableBaseCents statt grossTotalCents)", () => {
  const S2_NOW = new Date(Date.UTC(2070, 5, 15, 10, 0, 0));
  let orgId: string;
  let customerId: string;
  let quoteGrossTotalCents: number;

  beforeAll(async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "S2 Fix-Welle GmbH", addressLine1: "S2weg 1", postalCode: "10115", city: "Berlin", vatId: "DE222222222", taxNumber: "22/222/22222" },
    });
    orgId = org.id;
    await ensureOrgMasterdata(dbInternal, orgId);
    const customer = await dbInternal.customer.create({
      data: { orgId, name: "S2 Kunde AG", addressLine1: "Marktplatz 2", postalCode: "10117", city: "Berlin", type: "BUSINESS" },
    });
    customerId = customer.id;

    // 10.000,00 EUR netto @19 % -> 11.900,00 EUR brutto. Ein Abschlag (30 %) + Schlussrechnung.
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 1_000_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
      } as CreateDocumentInput,
      { now: S2_NOW },
    );
    quoteGrossTotalCents = quote.grossTotalCents;

    const dp = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: S2_NOW });
    await finalizeInvoice(dp.id, { now: S2_NOW });
    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: S2_NOW });
    await finalizeInvoice(final.id, { now: S2_NOW });
  });

  it("dashboardSummary.revenueThisMonthCents entspricht dem Gesamt-Bruttoauftragswert, nicht Abschlag+Schlussrechnung-Brutto addiert", async () => {
    const summary = await dashboardSummary(orgId, S2_NOW);
    // Vor der Fix-Welle: dp.grossTotalCents + final.grossTotalCents (beide voller Brutto-
    // Betrag) — der Abschlag waere doppelt gezaehlt worden, das Ergebnis haette den
    // tatsaechlichen Auftragswert (quoteGrossTotalCents) UEBERSCHRITTEN.
    expect(summary.revenueThisMonthCents).toBe(quoteGrossTotalCents);
  });

  it("customerOverview.kpis.totalRevenueCents entspricht ebenfalls dem Gesamt-Bruttoauftragswert", async () => {
    const overview = await customerOverview(orgId, customerId, S2_NOW);
    expect(overview.kpis.totalRevenueCents).toBe(quoteGrossTotalCents);
  });
});
