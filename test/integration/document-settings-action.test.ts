/**
 * M5 (Abschluss-Review Phase 12c, Fix-Welle) — saveDocumentSettingsAction
 * (src/app/actions/document-settings.ts): ein kaputtes `taxRates`-Feld (Hidden-Input
 * liefert normalerweise IMMER gueltiges JSON, aber ein manipulierter Request soll die
 * GoBD-relevante Steuersatz-Liste NICHT still auf [19,7,0] zuruecksetzen) muss die Action
 * mit einem lesbaren Fehler abbrechen, statt den Zod-Default stillschweigend zu speichern.
 * Muster fuer den getActiveOrg()-Mock: test/integration/save-customer-route.test.ts.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));
// Bei Erfolg revalidiert die Action "/einstellungen/belege" — ausserhalb eines echten
// Next.js-Request-Kontexts wirft revalidatePath sonst "Invariant: static generation store
// missing" (siehe test/integration/customer-inline-action.test.ts).
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { dbInternal } from "@/lib/db";
import { loadDocumentSettings } from "@/domain/document/settings";
import { saveDocumentSettingsAction } from "@/app/actions/document-settings";

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "DocSettings-Action Test GmbH", addressLine1: "Weg 1", postalCode: "10115", city: "Berlin" },
  });
  orgStore.id = org.id;
  // Org-Liste vorab auf einen erkennbaren, vom Default [19,7,0] abweichenden Wert setzen,
  // damit ein stiller Reset im Test sichtbar waere.
  await dbInternal.documentSettings.create({ data: { orgId: org.id, taxRatesJson: JSON.stringify([16, 5, 0]) } });
});

function fd(taxRatesRaw: string): FormData {
  const f = new FormData();
  f.set("taxRates", taxRatesRaw);
  return f;
}

describe("saveDocumentSettingsAction — taxRates (M5)", () => {
  it("kaputtes JSON im taxRates-Feld -> expliziter Fehler, Liste bleibt unveraendert", async () => {
    const res = await saveDocumentSettingsAction({ ok: false }, fd("{nicht json"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Steuersätze konnten nicht gelesen werden.");
    expect((await loadDocumentSettings(orgStore.id!)).taxRates).toEqual([16, 5, 0]);
  });

  it("taxRates ist kein Array (z. B. JSON-Objekt) -> derselbe explizite Fehler", async () => {
    const res = await saveDocumentSettingsAction({ ok: false }, fd('{"foo":"bar"}'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Steuersätze konnten nicht gelesen werden.");
    expect((await loadDocumentSettings(orgStore.id!)).taxRates).toEqual([16, 5, 0]);
  });

  it("gueltiges JSON-Array wird weiterhin gespeichert", async () => {
    const res = await saveDocumentSettingsAction({ ok: false }, fd(JSON.stringify([21, 9, 0])));
    expect(res.ok).toBe(true);
    expect((await loadDocumentSettings(orgStore.id!)).taxRates).toEqual([0, 9, 21]);
  });
});
