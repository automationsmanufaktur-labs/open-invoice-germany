/**
 * Phase 11c, Task 3 — createCustomerInline: Inline-Anlage eines Kunden aus dem
 * Beleg-Editor (CustomerPicker "+ Neuen Kunden anlegen"). Nutzt dieselbe Domain/Zod wie
 * saveCustomer (createCustomer), aber KEIN redirect — der angelegte Kunde wird
 * zurueckgegeben, damit der Aufrufer ihn sofort in den gerade bearbeiteten Beleg
 * uebernehmen kann.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));
vi.mock("@/lib/org", () => ({ getActiveOrg: async () => ({ id: orgStore.id! }) }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUserId: async () => "tester" }));
// `createCustomerInline` revalidiert "/kunden" bei Erfolg (wie `createProductInline` das
// Produktverzeichnis) — ausserhalb eines echten Next.js-Request-Kontexts wirft
// `revalidatePath` sonst "Invariant: static generation store missing". Die Server-Action
// laeuft im Produktivbetrieb innerhalb einer Route/Action-Anfrage, hier interessiert nur
// die Domain-Logik (Nummernkreis, Mandantenbindung).
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createCustomerInline } from "@/app/actions/masterdata";
import { GET as textTemplatesGet } from "@/app/api/text-templates/route";

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Inline Kunde GmbH", addressLine1: "A", postalCode: "1", city: "B", vatId: "DE744444444", taxNumber: "74/4" },
  });
  orgStore.id = org.id;
  await ensureOrgMasterdata(dbInternal, org.id);
  await dbInternal.textTemplate.create({
    data: { orgId: org.id, name: "Standard-Kopftext", docType: "INVOICE", position: "HEAD", body: "Vielen Dank fuer Ihren Auftrag.", isDefault: true },
  });
});

describe("createCustomerInline", () => {
  it("legt einen Kunden mit Kundennummer an und liefert ihn zurueck", async () => {
    const r = await createCustomerInline({ name: "Neu AG", addressLine1: "Weg 1", postalCode: "12345", city: "Stadt", email: "neu@example.org" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.customer.name).toBe("Neu AG");
      expect(r.customer.customerNumber).toMatch(/\S/);
      const row = await dbInternal.customer.findUnique({ where: { id: r.customer.id } });
      expect(row?.orgId).toBe(orgStore.id);
    }
  });

  it("Zod-Fehler werden als ok:false gemeldet", async () => {
    const r = await createCustomerInline({ name: "", addressLine1: "", postalCode: "", city: "" });
    expect(r.ok).toBe(false);
  });

  // Fix 1 (Task-3-Review): CustomerType ist "BUSINESS" | "CONSUMER" (nicht "PRIVATE",
  // wie der urspruengliche Brief faelschlich annahm) — CONSUMER muss ebenfalls anlegbar
  // sein.
  it("legt einen Privatkunden (CONSUMER) an", async () => {
    const r = await createCustomerInline({ name: "Erika Mustermann", type: "CONSUMER", addressLine1: "Weg 2", postalCode: "54321", city: "Dorf" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const row = await dbInternal.customer.findUnique({ where: { id: r.customer.id } });
      expect(row?.type).toBe("CONSUMER");
    }
  });
});

describe("GET /api/text-templates", () => {
  it("liefert die Textvorlagen der aktiven Organisation", async () => {
    const res = await textTemplatesGet(new Request("http://localhost/api/text-templates?docType=INVOICE&position=HEAD"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { templates: { id: string; name: string; body: string; isDefault: boolean }[] };
    // ensureOrgMasterdata (beforeAll) legt bereits eine System-Standardvorlage fuer
    // INVOICE/HEAD an — die Route liefert daher diese UND die eigens angelegte Vorlage.
    expect(json.templates.length).toBeGreaterThanOrEqual(2);
    expect(json.templates).toContainEqual({ id: expect.any(String), name: "Standard-Kopftext", body: "Vielen Dank fuer Ihren Auftrag.", isDefault: expect.any(Boolean) });
  });

  it("meldet eine ungueltige Position als 400", async () => {
    const res = await textTemplatesGet(new Request("http://localhost/api/text-templates?docType=INVOICE&position=BOGUS"));
    expect(res.status).toBe(400);
  });
});
