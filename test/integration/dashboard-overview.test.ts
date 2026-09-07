/**
 * Phase 8b, Task 4 — Domain-Tests: `dashboardSummary` (src/domain/dashboard/summary.ts),
 * `agingBuckets` (geteilter Aging-Helfer, auch von `loadDunningOverview` genutzt) und
 * `customerOverview` (src/domain/customer/overview.ts). Eigenes Jahr 2066
 * (Testjahr-Konvention, plan-header.md).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { recordPayment } from "@/domain/invoice/payment";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { setQuoteStatus } from "@/domain/document/status";
import { dashboardSummary, agingBuckets } from "@/domain/dashboard/summary";
import { customerOverview } from "@/domain/customer/overview";
import { NotFoundError } from "@/domain/errors";
import type { CreateInvoiceInput, CreateDocumentInput } from "@/schemas";

let orgId: string;
let customerId: string;

const NOW = new Date(2066, 4, 15, 10, 0, 0);
const PAST_10 = new Date(2066, 4, 5, 10, 0, 0);
const PAST_40 = new Date(2066, 3, 5, 10, 0, 0);

function line(description: string) {
  return {
    description,
    quantityMilli: 1000,
    unit: "HUR" as const,
    unitNetPriceCents: 10000,
    taxRate: 19 as const,
    taxCategory: "S" as const,
    discountPermille: 0,
  };
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Dashboard Test GmbH", addressLine1: "Dashboardweg 1", postalCode: "10115", city: "Berlin", vatId: "DE111222333", taxNumber: "44/555/66677" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Dashboardkunde AG", addressLine1: "Marktplatz 3", postalCode: "10117", city: "Berlin", type: "BUSINESS" },
  });
  customerId = customer.id;

  // Rechnung 1: ueberfaellig seit 10 Tagen (Bucket d1_7 faellt raus, d8_30 trifft).
  const inv1 = await createDraftInvoice(
    orgId,
    { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: PAST_40, lines: [line("Dashboard ueberfaellig 10 Tage")] } as CreateInvoiceInput,
    { now: PAST_40 },
  );
  await dbInternal.invoice.update({ where: { id: inv1.id }, data: { dueDate: PAST_10 } });
  await finalizeInvoice(inv1.id, { now: PAST_40 });

  // Rechnung 2: ueberfaellig seit 40 Tagen (Bucket d31_60).
  const inv2 = await createDraftInvoice(
    orgId,
    { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: PAST_40, lines: [line("Dashboard ueberfaellig 40 Tage")] } as CreateInvoiceInput,
    { now: PAST_40 },
  );
  await dbInternal.invoice.update({ where: { id: inv2.id }, data: { dueDate: PAST_40 } });
  await finalizeInvoice(inv2.id, { now: PAST_40 });

  // Rechnung 3: im laufenden Monat ausgestellt (Umsatz laufender Monat), bereits bezahlt.
  const inv3 = await createDraftInvoice(
    orgId,
    { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: NOW, dueDate: NOW, lines: [line("Dashboard Umsatz laufender Monat")] } as CreateInvoiceInput,
    { now: NOW },
  );
  await finalizeInvoice(inv3.id, { now: NOW });

  // Rechnung 4: teilweise bezahlt (Fix-Runde 1, §45 partiallyPaid-Kennzahl), faellig vor
  // 3 Tagen (bleibt auch nach der Teilzahlung ueberfaellig/offen).
  const PAST_3 = new Date(2066, 4, 12, 10, 0, 0);
  const inv4 = await createDraftInvoice(
    orgId,
    { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: PAST_3, dueDate: PAST_3, lines: [line("Dashboard teilweise bezahlt")] } as CreateInvoiceInput,
    { now: PAST_3 },
  );
  await finalizeInvoice(inv4.id, { now: PAST_3 });
  const inv4Finalized = await dbInternal.invoice.findUniqueOrThrow({ where: { id: inv4.id } });
  await recordPayment(inv4.id, { amountCents: Math.floor(inv4Finalized.grossTotalCents / 2), paidAt: NOW, method: "TRANSFER", isSkonto: false, applySkonto: false });

  // NOW liegt im Jahr 2066 — createBusinessDocument setzt ohne explizites `validUntil`
  // den Default relativ zur ECHTEN Systemzeit (kein injizierbares `now`, siehe
  // src/domain/document/create.ts), das laege also VOR dem fiktiven Testjahr und wuerde
  // effectiveQuoteStatus sofort auf EXPIRED setzen. Deshalb hier explizit in der Zukunft
  // relativ zu NOW.
  const FAR_FUTURE = new Date(2066, 11, 31);

  // Angebot: DRAFT — zaehlt NICHT als offen (Fix-Welle Nit: die Dashboard-Kachel zaehlt
  // nur SENT, weil sie auf /dokumente?status=SENT verlinkt — vorher zaehlte sie
  // faelschlich auch DRAFT mit, Kachel-Zahl und Ziel-Liste liefen auseinander).
  await createBusinessDocument(orgId, {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    validUntil: FAR_FUTURE,
    lines: [line("Dashboard Entwurf-Angebot")],
  } as CreateDocumentInput);

  // Angebot: SENT — zaehlt als offen.
  const sentQuote = await createBusinessDocument(orgId, {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    validUntil: FAR_FUTURE,
    lines: [line("Dashboard offenes Angebot")],
  } as CreateDocumentInput);
  await setQuoteStatus(orgId, sentQuote.id, "SENT", { now: NOW });

  // Angebot: bereits angenommen (zaehlt NICHT als offen).
  const acceptedQuote = await createBusinessDocument(orgId, {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    validUntil: FAR_FUTURE,
    lines: [line("Dashboard angenommenes Angebot")],
  } as CreateDocumentInput);
  await setQuoteStatus(orgId, acceptedQuote.id, "SENT", { now: NOW });
  await setQuoteStatus(orgId, acceptedQuote.id, "ACCEPTED", { now: NOW });
});

describe("agingBuckets", () => {
  it("ordnet Zeilen den richtigen Buckets zu und laesst daysOverdue < minDays aussen vor (Default minDays=1)", () => {
    const result = agingBuckets(
      [
        { dueDate: PAST_10, cents: 1000 }, // 10 Tage -> Bucket 1 (8-30)
        { dueDate: PAST_40, cents: 2000 }, // 40 Tage -> Bucket 2 (31-60)
        { dueDate: NOW, cents: 500 }, // heute faellig, daysOverdue=0 -> zaehlt NICHT (Default minDays=1)
      ],
      NOW,
    );
    expect(result).toHaveLength(4); // bounds [7,30,60] -> 4 Buckets
    expect(result[0]).toEqual({ label: "1–7 Tage", count: 0, cents: 0 });
    expect(result[1]).toEqual({ label: "8–30 Tage", count: 1, cents: 1000 });
    expect(result[2]).toEqual({ label: "31–60 Tage", count: 1, cents: 2000 });
    expect(result[3]).toEqual({ label: "> 60 Tage", count: 0, cents: 0 });
  });

  it("respektiert benutzerdefinierte bounds", () => {
    const result = agingBuckets([{ dueDate: PAST_10, cents: 1000 }], NOW, [3, 20, 50]);
    expect(result[0].count).toBe(0); // 10 Tage > bounds[0]=3
    expect(result[1].count).toBe(1); // <= bounds[1]=20
  });

  it("minDays: 0 schliesst den Faelligkeitstag selbst (daysOverdue===0) mit ein (Dashboard, §45)", () => {
    // Sechs synthetische Zeilen bei 0/5/20/45/75/120 Tagen ueberfaellig, Dashboard-Grenzen
    // [7, 30, 60, 90] -> 5 Buckets (0-7/8-30/31-60/61-90/>90).
    const dayMs = 24 * 60 * 60 * 1000;
    const rows = [0, 5, 20, 45, 75, 120].map((days) => ({ dueDate: new Date(NOW.getTime() - days * dayMs), cents: 100 }));
    const result = agingBuckets(rows, NOW, [7, 30, 60, 90], { minDays: 0 });
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ label: "0–7 Tage", count: 2, cents: 200 }); // 0, 5 Tage
    expect(result[1]).toEqual({ label: "8–30 Tage", count: 1, cents: 100 }); // 20 Tage
    expect(result[2]).toEqual({ label: "31–60 Tage", count: 1, cents: 100 }); // 45 Tage
    expect(result[3]).toEqual({ label: "61–90 Tage", count: 1, cents: 100 }); // 75 Tage
    expect(result[4]).toEqual({ label: "> 90 Tage", count: 1, cents: 100 }); // 120 Tage
  });
});

describe("dashboardSummary", () => {
  it("liefert ueberfaellige Rechnungen, Aging, Umsatz laufender Monat, offene Angebote und die neuen Fix-Runde-1-Kennzahlen (§45)", async () => {
    const summary = await dashboardSummary(orgId, NOW);

    // Fix-Welle (S1, Ruling): PARTIALLY_PAID faellt jetzt in den dueDate-Zweig von
    // effectiveInvoiceStatus (OPEN/DUE/OVERDUE), solange ein Restbetrag offen ist — inv4
    // ist teilweise bezahlt UND faellig seit 3 Tagen, zaehlt also jetzt zusaetzlich zu
    // inv1 (10d) + inv2 (40d) als OVERDUE. Vorher verschwand eine teilbezahlte
    // ueberfaellige Rechnung komplett aus overdueInvoices/aging (der eigentliche Bug: die
    // Kundenuebersicht/das Dashboard meldeten "0 € ueberfaellig" fuer einen Kunden, der
    // noch die Haelfte einer ueberfaelligen Rechnung schuldete).
    expect(summary.overdueInvoices.count).toBe(3);
    expect(summary.overdueInvoices.cents).toBeGreaterThan(0);

    // Dashboard-Aging (Grenzen 7/30/60/90, minDays: 0) -> 5 Buckets; Tag 0 (inv3, faellig
    // heute) UND inv4 (3d, teilbezahlt-ueberfaellig) faellen in den ersten Bucket, inv1
    // (10d) in den zweiten, inv2 (40d) in den dritten.
    expect(summary.aging).toHaveLength(5);
    const bucketTotal = summary.aging.reduce((sum, b) => sum + b.count, 0);
    expect(bucketTotal).toBe(4); // inv1, inv2, inv3 (faellig heute), inv4 (3d)
    expect(summary.aging[0].count).toBe(2); // inv3 (0d), inv4 (3d)
    expect(summary.aging[1].count).toBe(1); // inv1 (10d)
    expect(summary.aging[2].count).toBe(1); // inv2 (40d)

    expect(summary.revenueThisMonthCents).toBeGreaterThan(0);

    expect(summary.recentDocuments.length).toBeGreaterThan(0);
    expect(summary.recentDocuments.length).toBeLessThanOrEqual(5);

    // Ein Angebot ist offen (DRAFT), eines wurde bereits angenommen.
    expect(summary.openQuotes.count).toBe(1);

    // Fix-Runde 1 (§45): dueThisWeek — inv3 ist heute faellig (innerhalb der naechsten 7
    // Tage), inv1/inv2/inv4 liegen bereits in der Vergangenheit.
    expect(summary.dueThisWeek.count).toBeGreaterThanOrEqual(1);
    expect(summary.dueThisWeek.cents).toBeGreaterThan(0);

    // Fix-Runde 1 (§45): partiallyPaid — genau inv4.
    expect(summary.partiallyPaid.count).toBe(1);
    expect(summary.partiallyPaid.cents).toBeGreaterThan(0);

    // Fix-Runde 1 (§45): dunningRequired — dieselbe Auswahl wie dunningCandidates
    // (dunning/auto.ts); inv1/inv2/inv4 sind alle FINALIZED, faellig und mahnbar.
    expect(summary.dunningRequired.count).toBeGreaterThanOrEqual(3);
  });
});

describe("customerOverview", () => {
  it("liefert KPIs und Belegtabs des Kunden", async () => {
    const overview = await customerOverview(orgId, customerId, NOW);
    expect(overview.customer.id).toBe(customerId);
    expect(overview.kpis.overdueCents).toBeGreaterThan(0);
    expect(overview.kpis.totalRevenueCents).toBeGreaterThan(0);
    expect(overview.invoices.length).toBe(4); // inv1, inv2, inv3, inv4 (teilweise bezahlt)
    expect(overview.quotes.length).toBe(3);
  });

  it("wirft NotFoundError fuer unbekannten Kunden", async () => {
    await expect(customerOverview(orgId, "does-not-exist", NOW)).rejects.toThrow(NotFoundError);
  });

  it("wirft NotFoundError fuer Kunden einer anderen Organisation (Org-Scoping)", async () => {
    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "Fremdorg GmbH", addressLine1: "Fremdweg 1", postalCode: "10119", city: "Berlin", vatId: "DE999888777", taxNumber: "77/888/99900" },
    });
    await expect(customerOverview(otherOrg.id, customerId, NOW)).rejects.toThrow(NotFoundError);
  });
});
