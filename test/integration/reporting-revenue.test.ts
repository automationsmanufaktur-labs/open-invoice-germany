/**
 * Phase 12e, Task 2 — monthlyRevenue und topCustomers. Eigenes Jahr 2085
 * (Testjahr-Konvention) und eigener Nummernkreis-Praefix (es wird festgeschrieben).
 * Alle Monatsgrenzen in UTC — der Testlauf muss auch mit `TZ=UTC npm test` gruen sein.
 *
 * Fix 1 (Review): Gutschriften werden ueber die echte Domain-Funktion
 * `createPartialCreditNote` erzeugt (nicht mehr per Hand mit `type: CREDIT_NOTE" und
 * positiven Betraegen) — so entstehen die real vorkommenden negativen Betraege. Zusaetzlich
 * ein Storno-Szenario (`cancelInvoice`) ueber zwei Monate: das Original zaehlt unveraendert
 * in seinem Ausstellungsmonat, die Storno-Gutschrift mindert separat den
 * Stornierungsmonat — Periodensumme 0.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createPartialCreditNote } from "@/domain/invoice/credit";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { monthlyRevenue, netShareCents, signedRevenueShareCents, monthKey } from "@/domain/reporting/revenue";
import { topCustomers } from "@/domain/reporting/customers";
import type { CreateInvoiceInput } from "@/schemas";

const NOW = new Date(Date.UTC(2085, 5, 15, 10, 0, 0));      // Juni 2085
const FEBRUARY = new Date(Date.UTC(2085, 1, 10, 10, 0, 0));
const MARCH = new Date(Date.UTC(2085, 2, 10, 10, 0, 0));
const APRIL = new Date(Date.UTC(2085, 3, 10, 10, 0, 0));
const MAY = new Date(Date.UTC(2085, 4, 20, 10, 0, 0));

let orgId: string;
let customerA: string;
let customerB: string;
let customerC: string;

function line(netCents: number) {
  return { description: "Leistung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: netCents, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };
}

async function invoice(customerId: string, netCents: number, issueDate: Date, finalize = true) {
  const inv = await createDraftInvoice(
    orgId,
    { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate, lines: [line(netCents)] } as CreateInvoiceInput,
    { now: issueDate },
  );
  if (finalize) await finalizeInvoice(inv.id, { now: issueDate });
  return inv;
}

/**
 * Fix I2 (Abschluss-Review): freistehende Gutschrift ueber den normalen Pfad (kein
 * `createPartialCreditNote`) — `createDraftInvoice`/`finalizeInvoice` mit `type:
 * "CREDIT_NOTE"` und POSITIVEN Positionsbetraegen, exakt die naheliegende Eingabe im Editor
 * (`createInvoiceSchema.unitNetPriceCents` erzwingt kein Vorzeichen).
 */
async function creditNote(targetOrgId: string, customerId: string, netCents: number, issueDate: Date) {
  const inv = await createDraftInvoice(
    targetOrgId,
    { customerId, type: "CREDIT_NOTE", taxScheme: "REGULAR", currency: "EUR", issueDate, lines: [line(netCents)] } as CreateInvoiceInput,
    { now: issueDate },
  );
  await finalizeInvoice(inv.id, { now: issueDate });
  return inv;
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Report Test GmbH", addressLine1: "Reportweg 1", postalCode: "10115", city: "Berlin", vatId: "DE855555555", taxNumber: "85/555/55555" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  customerA = (await dbInternal.customer.create({ data: { orgId, name: "Alpha AG", addressLine1: "A 1", postalCode: "10117", city: "Berlin", type: "BUSINESS" } })).id;
  customerB = (await dbInternal.customer.create({ data: { orgId, name: "Beta GmbH", addressLine1: "B 1", postalCode: "10117", city: "Berlin", type: "BUSINESS" } })).id;
  customerC = (await dbInternal.customer.create({ data: { orgId, name: "Gamma KG", addressLine1: "G 1", postalCode: "10117", city: "Berlin", type: "BUSINESS" } })).id;

  const aprilInvoiceA = await invoice(customerA, 100000, APRIL);   // April: 1.000 €
  await invoice(customerA, 50000, MAY);                            // Mai:     500 €
  await invoice(customerB, 30000, MAY);                            // Mai:     300 €
  await invoice(customerB, 999999, MAY, false);                    // Entwurf -> zaehlt nicht

  // Echte Teilgutschrift (negative Betraege, wie von createPartialCreditNote erzeugt) auf
  // die April-Rechnung von Alpha, ausgestellt im Mai -> mindert den Mai-Umsatz um 200 €.
  await createPartialCreditNote(
    aprilInvoiceA.id,
    { lines: [{ description: "Teilgutschrift", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 20000, taxRate: 19, taxCategory: "S" }] },
    { now: MAY },
  );

  // Storno-Szenario (Fix 1): Rechnung im Februar, Storno im Maerz — Original bleibt mit
  // vollem Betrag im Februar stehen (GoBD, status wechselt nur auf CANCELLED), die
  // Storno-Gutschrift traegt den negierten Betrag im Maerz.
  const febInvoiceC = await invoice(customerC, 40000, FEBRUARY);
  await cancelInvoice(febInvoiceC.id, { now: MARCH });
});

describe("monthlyRevenue", () => {
  it("liefert 12 lueckenlose Monate, summiert netto und zieht Gutschriften ab", async () => {
    const rows = await monthlyRevenue(orgId, { now: NOW });
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe("2084-07");
    expect(rows[11].month).toBe("2085-06");
    expect(rows.find((r) => r.month === "2085-04")?.netCents).toBe(100000);
    const may = rows.find((r) => r.month === "2085-05");
    expect(may?.netCents).toBe(50000 + 30000 - 20000);   // Entwurf (999.999) zaehlt NICHT mit
    expect(may?.count).toBe(3);
  });

  it("filtert nach Kunde und ist org-gescoped", async () => {
    const b = await monthlyRevenue(orgId, { customerId: customerB, now: NOW });
    expect(b.find((r) => r.month === "2085-05")?.netCents).toBe(30000);
    expect(b.find((r) => r.month === "2085-04")?.netCents).toBe(0);
    const other = await dbInternal.organization.create({ data: { legalName: "Fremd GmbH", addressLine1: "F 1", postalCode: "10115", city: "Berlin" } });
    expect((await monthlyRevenue(other.id, { now: NOW })).every((r) => r.netCents === 0)).toBe(true);
  });

  it("monthKey und netShareCents sind reine Funktionen", () => {
    expect(monthKey(new Date(Date.UTC(2085, 0, 31, 23, 59, 59)))).toBe("2085-01");
    expect(netShareCents({ netTotalCents: 10000, grossTotalCents: 11900, payableCents: null })).toBe(10000);
    // Schlussrechnung: 11.900 brutto, davon 5.950 zahlbar -> halbes Netto.
    expect(netShareCents({ netTotalCents: 10000, grossTotalCents: 11900, payableCents: 5950 })).toBe(5000);
    expect(netShareCents({ netTotalCents: 10000, grossTotalCents: 0, payableCents: 0 })).toBe(0);
  });

  it("storniertes Original bleibt im Ausstellungsmonat stehen, die Storno-Gutschrift mindert den Stornierungsmonat, Periodensumme 0", async () => {
    const rows = await monthlyRevenue(orgId, { customerId: customerC, now: NOW });
    expect(rows.find((r) => r.month === "2085-02")?.netCents).toBe(40000);
    expect(rows.find((r) => r.month === "2085-02")?.count).toBe(1);
    expect(rows.find((r) => r.month === "2085-03")?.netCents).toBe(-40000);
    expect(rows.find((r) => r.month === "2085-03")?.count).toBe(1);
    expect(rows.reduce((sum, r) => sum + r.netCents, 0)).toBe(0);
  });
});

describe("topCustomers", () => {
  it("sortiert absteigend nach Netto, zaehlt Belege, schneidet bei limit", async () => {
    const rows = await topCustomers(orgId, { months: 12, limit: 5, now: NOW });
    expect(rows.length).toBeLessThanOrEqual(5);
    // Alphas Mai-Teilgutschrift (echte negative Betraege, siehe beforeAll) mindert Alphas
    // eigene Summe (nicht die von Beta).
    expect(rows[0]).toMatchObject({ name: "Alpha AG", netCents: 100000 + 50000 - 20000, invoiceCount: 3 });
    expect(rows[1]).toMatchObject({ name: "Beta GmbH", netCents: 30000, invoiceCount: 1 });
  });
  it("stornierter Kunde erscheint mit Netto 0 (Original + Storno gleichen sich aus)", async () => {
    const rows = await topCustomers(orgId, { months: 12, limit: 10, now: NOW });
    expect(rows.find((r) => r.customerId === customerC)).toMatchObject({ name: "Gamma KG", netCents: 0, invoiceCount: 2 });
  });
  it("liefert eine leere Liste ohne Belege", async () => {
    const other = await dbInternal.organization.create({ data: { legalName: "Leer GmbH", addressLine1: "L 1", postalCode: "10115", city: "Berlin" } });
    expect(await topCustomers(other.id, { now: NOW })).toEqual([]);
  });
});

describe("Fix I2 — Vorzeichen-Normalisierung bei manuell angelegten Gutschriften", () => {
  // Eigenes Jahr 2091 (Testjahr-Konvention): Belegnummern sind instanzweit @unique, nicht je
  // Org (siehe CLAUDE.md) — der Nummernkreis jeder neuen Org startet wieder bei 1, ein
  // geteiltes Jahr mit dem Hauptszenario (2085, oben) wuerde bei der ersten Rechnung
  // kollidieren.
  const NOW91 = new Date(Date.UTC(2091, 5, 15, 10, 0, 0));
  const MAY91 = new Date(Date.UTC(2091, 4, 20, 10, 0, 0));

  it("eine freistehende Gutschrift mit POSITIVEN Positionsbetraegen mindert den Umsatz, statt ihn zu erhoehen", async () => {
    // Eigene Org: die Fixture-Daten des Hauptszenarios (oben) bleiben unberuehrt.
    const org = await dbInternal.organization.create({
      data: { legalName: "Signum Test GmbH", addressLine1: "S 1", postalCode: "10115", city: "Berlin", vatId: "DE866666666", taxNumber: "86/666/66666" },
    });
    await ensureOrgMasterdata(dbInternal, org.id);
    const customer = (
      await dbInternal.customer.create({ data: { orgId: org.id, name: "Delta AG", addressLine1: "D 1", postalCode: "10117", city: "Berlin", type: "BUSINESS" } })
    ).id;

    const inv = await createDraftInvoice(
      org.id,
      { customerId: customer, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: MAY91, lines: [line(50000)] } as CreateInvoiceInput,
      { now: MAY91 },
    );
    await finalizeInvoice(inv.id, { now: MAY91 }); // 500 € netto

    // Gutschrift ueber den NORMALEN Pfad (createDraftInvoice/finalizeInvoice, nicht
    // createPartialCreditNote) mit positiven Betraegen — die naheliegende Eingabe im Editor.
    await creditNote(org.id, customer, 20000, MAY91); // 200 € netto, POSITIV eingegeben

    const rows = await monthlyRevenue(org.id, { now: NOW91 });
    const may = rows.find((r) => r.month === "2091-05");
    // Vorher (Bug): 50000 + 20000 = 70000 (Gutschrift erhoehte den Umsatz). Richtig: mindert.
    expect(may?.netCents).toBe(50000 - 20000);
    expect(may?.count).toBe(2);

    const top = await topCustomers(org.id, { now: NOW91 });
    expect(top.find((t) => t.customerId === customer)).toMatchObject({ netCents: 50000 - 20000, invoiceCount: 2 });
  });

  it("signedRevenueShareCents ist idempotent fuer bereits negative Domain-Gutschriften", () => {
    // Eine echte Domain-Gutschrift (createPartialCreditNote/cancelInvoice) traegt bereits
    // negative Betraege -- -Math.abs(share) darf daran nichts aendern.
    const negative = { netTotalCents: -20000, grossTotalCents: -23800, payableCents: null, type: "CREDIT_NOTE" };
    expect(signedRevenueShareCents(negative)).toBe(-20000);
    const positive = { netTotalCents: 20000, grossTotalCents: 23800, payableCents: null, type: "CREDIT_NOTE" };
    expect(signedRevenueShareCents(positive)).toBe(-20000);
    const normalInvoice = { netTotalCents: 20000, grossTotalCents: 23800, payableCents: null, type: "INVOICE" };
    expect(signedRevenueShareCents(normalInvoice)).toBe(20000);
  });
});
