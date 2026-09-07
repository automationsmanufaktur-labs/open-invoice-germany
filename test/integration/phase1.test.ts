/**
 * Phase 1 — Belegverknuepfungen: Dual-Write (Altfeld + DocumentRelation) und
 * Idempotenz des Backfill-SQL aus Task 1.
 *
 * Eigenes Jahr fuer die Nummernvergabe: "Invoice.number" ist global @unique
 * und test.db wird ueber die gesamte Testlaufzeit geteilt (gobd.test.ts nutzt
 * 2026, snapshot.test.ts 2027).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { createBusinessDocument } from "@/domain/document/create";
import { convertDocumentToInvoice } from "@/domain/document/convert";
import { listRelations } from "@/domain/relations";

const FIX = new Date("2028-03-01T10:00:00.000Z");
const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

async function setup() {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Test GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "21339",
      city: "Lüneburg",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
    },
  });
  const customer = await dbInternal.customer.create({
    data: { orgId: org.id, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  return { orgId: org.id, customerId: customer.id };
}

describe("Phase 1 — Verknuepfungen", () => {
  let orgId = "";
  let customerId = "";
  beforeAll(async () => {
    ({ orgId, customerId } = await setup());
  });

  it("Angebot -> Rechnung schreibt Altfeld UND DocumentRelation", async () => {
    const q = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] });
    const inv = await convertDocumentToInvoice(orgId, q.id, { now: FIX });
    const rel = await listRelations(orgId, "QUOTE", q.id);
    expect(rel).toEqual([expect.objectContaining({ toType: "INVOICE", toId: inv.id, relationType: "CONVERTED_TO" })]);
    const q2 = await dbInternal.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(q2.convertedToInvoiceId).toBe(inv.id);
  });

  it("Storno schreibt REVERSES und CORRECTS", async () => {
    const inv = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [line], deliveryDate: FIX });
    await finalizeInvoice(inv.id, { now: FIX });
    const { creditNote } = await cancelInvoice(inv.id, { now: FIX });
    const rels = await listRelations(orgId, "INVOICE", creditNote.id);
    expect(rels.map((r) => r.relationType).sort()).toEqual(["CORRECTS", "REVERSES"]);
  });

  it("Backfill-Migration spiegelt Altfelder idempotent", async () => {
    const q = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] });
    const inv = await convertDocumentToInvoice(orgId, q.id, { now: FIX });
    await dbInternal.documentRelation.deleteMany({ where: { fromId: q.id } });
    const dir = readdirSync("prisma/migrations").find((d) => d.endsWith("_phase1_backfill"))!;
    const sql = readFileSync(join("prisma/migrations", dir, "migration.sql"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const run = async () => { for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) await dbInternal.$executeRawUnsafe(s); };
    await run(); await run(); // zweimal: idempotent
    const rel = await listRelations(orgId, "QUOTE", q.id);
    expect(rel).toHaveLength(1);
    expect(rel[0].toId).toBe(inv.id);
    expect(await dbInternal.paymentMethod.count({ where: { orgId } })).toBe(8);
    expect(await dbInternal.dunningStage.count({ where: { orgId } })).toBe(4);
  });

  it("Lieferschein bekommt LS-Nummer, Snapshot CREATE und ChangeLog", async () => {
    const { createDeliveryNote } = await import("@/domain/delivery-note/create");
    const dn = await createDeliveryNote(orgId, { customerId, showPrices: false, showTax: false, showArticleNumber: true, showDescription: true, lines: [{ description: "Router", quantityMilli: 2000, unit: "C62" }] }, { now: FIX });
    expect(dn.number).toBe("LS-2028-0001");
    expect(dn.snapshotSource).toBe("CREATE");
    expect(dn.lines).toHaveLength(1);
    const log = await dbInternal.changeLog.findFirst({ where: { entity: "DELIVERY_NOTE", entityId: dn.id } });
    expect(log?.action).toBe("CREATE");

    const dn2 = await createDeliveryNote(orgId, { customerId, showPrices: false, showTax: false, showArticleNumber: true, showDescription: true, lines: [{ description: "Kabel", quantityMilli: 1000, unit: "C62" }] }, { now: FIX });
    expect(dn2.number).toBe("LS-2028-0002");
  });

  it("neue Organisation bekommt Systemzahlungsmethoden und Mahnstufen", async () => {
    const { ensureOrgMasterdata } = await import("@/domain/masterdata/ensure");
    const org = await dbInternal.organization.create({ data: { legalName: "Neu GmbH", addressLine1: "A 1", postalCode: "1", city: "B" } });
    await ensureOrgMasterdata(dbInternal, org.id);
    await ensureOrgMasterdata(dbInternal, org.id); // idempotent
    expect(await dbInternal.paymentMethod.count({ where: { orgId: org.id, isSystem: true } })).toBe(8);
    expect(await dbInternal.dunningStage.count({ where: { orgId: org.id } })).toBe(4);
  });

  it("recordPayment lehnt unbekannte Zahlungsmethode ab und akzeptiert Systemcode", async () => {
    const { recordPayment } = await import("@/domain/invoice/payment");
    const { ensureOrgMasterdata } = await import("@/domain/masterdata/ensure");
    await ensureOrgMasterdata(dbInternal, orgId);
    const inv = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [line], deliveryDate: FIX });
    await finalizeInvoice(inv.id, { now: FIX });
    await expect(recordPayment(inv.id, { amountCents: 100, method: "GIBTSNICHT", isSkonto: false })).rejects.toThrow(/Zahlungsmethode/);
    await expect(recordPayment(inv.id, { amountCents: 100, method: "PAYPAL", isSkonto: false })).resolves.toBeTruthy();
  });
});
