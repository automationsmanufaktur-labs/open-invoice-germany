/**
 * Fix-Welle Phase 8b (final-review-findings.md B1): `loadListPage` (src/lib/list-page.ts)
 * darf niemals werfen, egal was die Listen-Seiten als `searchParams` durchreichen — weder
 * leere Strings (FilterBar-<select> "Alle") noch handgeschriebene Unsinnswerte
 * (`offset=abc`). Vor der Fix-Welle riefen die Seiten `listInvoices`/`listQuotes`/
 * `listDeliveryNotes`/`listRecurring` direkt mit dem rohen `searchParams`-Objekt auf —
 * ein `ZodError` zerschoss die Server-Component (Next.js-Fehlerseite) beim ersten Klick
 * auf "Filtern". Dieser Test belegt zuerst die direkte, ungeschuetzte Aufrufkette
 * (schlaegt fehl), dann `loadListPage` (bleibt gruen).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { listInvoices } from "@/domain/invoice/list";
import { listQuotes, listDeliveryNotes, listRecurring } from "@/domain/document/list";
import { loadListPage } from "@/lib/list-page";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Listen-Loader Test GmbH",
      addressLine1: "Loaderweg 1",
      postalCode: "10115",
      city: "Berlin",
    },
  });
  orgId = org.id;
});

const EMPTY_FILTERBAR_SUBMIT = { q: "", status: "", type: "", from: "", to: "" };
const HANDCRAFTED_URL = { offset: "abc", status: "foo" };

describe("Listen-Seiten stuerzen bei leeren/ungueltigen Filterwerten nicht ab (B1)", () => {
  it("direkter Aufruf von listInvoices mit leeren FilterBar-Strings wirft (Beleg fuer den Bug)", async () => {
    await expect(listInvoices(orgId, EMPTY_FILTERBAR_SUBMIT)).rejects.toThrow();
  });

  it("direkter Aufruf von listInvoices mit handgeschriebenen Unsinnswerten wirft (Beleg fuer den Bug)", async () => {
    await expect(listInvoices(orgId, HANDCRAFTED_URL)).rejects.toThrow();
  });

  it("loadListPage(listInvoices) liefert bei leeren FilterBar-Strings das Default-Ergebnis, ohne zu werfen", async () => {
    const result = await loadListPage(EMPTY_FILTERBAR_SUBMIT, (f) => listInvoices(orgId, f), { booleanKeys: ["eInvoice"] });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("loadListPage(listInvoices) liefert bei handgeschriebenen Unsinnswerten das Default-Ergebnis, ohne zu werfen", async () => {
    const result = await loadListPage(HANDCRAFTED_URL, (f) => listInvoices(orgId, f), { booleanKeys: ["eInvoice"] });
    expect(result.rows).toEqual([]);
    expect(result.offset).toBe(0);
  });

  it("loadListPage(listQuotes) mit includeArchived als extra + leeren Strings wirft nicht", async () => {
    const result = await loadListPage({ ...EMPTY_FILTERBAR_SUBMIT, kind: "" }, (f) => listQuotes(orgId, f), {
      extra: { includeArchived: false },
    });
    expect(result.total).toBe(0);
  });

  it("loadListPage(listDeliveryNotes) mit includeArchived als extra + leeren Strings wirft nicht", async () => {
    const result = await loadListPage(EMPTY_FILTERBAR_SUBMIT, (f) => listDeliveryNotes(orgId, f), {
      extra: { includeArchived: false },
    });
    expect(result.total).toBe(0);
  });

  it("loadListPage(listRecurring) mit leeren Strings wirft nicht", async () => {
    const result = await loadListPage({ q: "", status: "" }, (f) => listRecurring(orgId, f), {});
    expect(result.total).toBe(0);
  });
});
