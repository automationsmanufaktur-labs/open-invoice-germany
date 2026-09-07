import { describe, it, expect, beforeAll } from "vitest";
import { tableForRefType, linkDocuments, listRelations, RelationError } from "@/domain/relations";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";

describe("relations", () => {
  it("ordnet jeden DocRefType einer Tabelle zu", () => {
    expect(tableForRefType("QUOTE")).toBe("quote");
    expect(tableForRefType("INVOICE")).toBe("invoice");
    expect(tableForRefType("RECURRING")).toBe("recurringInvoice");
    expect(tableForRefType("DELIVERY_NOTE")).toBe("deliveryNote");
    expect(tableForRefType("DUNNING")).toBe("dunning");
  });

  describe("Mandantenfilter", () => {
    let orgAId = "";
    let orgBId = "";
    let customerAId = "";
    let customerBId = "";
    const line = { lineType: "ITEM" as const, description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 };

    beforeAll(async () => {
      const orgA = await dbInternal.organization.create({
        data: { legalName: "Relations A GmbH", addressLine1: "Str. 1", postalCode: "10115", city: "Berlin" },
      });
      const orgB = await dbInternal.organization.create({
        data: { legalName: "Relations B GmbH", addressLine1: "Str. 2", postalCode: "10115", city: "Berlin" },
      });
      orgAId = orgA.id;
      orgBId = orgB.id;
      customerAId = (await dbInternal.customer.create({ data: { orgId: orgAId, name: "Kunde A", addressLine1: "X 1", postalCode: "1", city: "Y", type: "BUSINESS" } })).id;
      customerBId = (await dbInternal.customer.create({ data: { orgId: orgBId, name: "Kunde B", addressLine1: "X 1", postalCode: "1", city: "Y", type: "BUSINESS" } })).id;
    });

    it("linkDocuments wirft, wenn der referenzierte Beleg zu einer anderen Org gehoert", async () => {
      const invA = await createDraftInvoice(orgAId, { customerId: customerAId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", documentDiscountPermille: 0, documentDiscountCents: 0, documentChargePermille: 0, documentChargeCents: 0, lines: [line], deliveryDate: new Date() });
      const invB = await createDraftInvoice(orgBId, { customerId: customerBId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", documentDiscountPermille: 0, documentDiscountCents: 0, documentChargePermille: 0, documentChargeCents: 0, lines: [line], deliveryDate: new Date() });

      await expect(
        dbInternal.$transaction((tx) =>
          linkDocuments(tx, { orgId: orgAId, fromType: "INVOICE", fromId: invA.id, toType: "INVOICE", toId: invB.id, relationType: "CORRECTS" }),
        ),
      ).rejects.toThrow(RelationError);
    });

    it("listRelations liefert keine Relation einer fremden Org", async () => {
      const invA1 = await createDraftInvoice(orgAId, { customerId: customerAId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", documentDiscountPermille: 0, documentDiscountCents: 0, documentChargePermille: 0, documentChargeCents: 0, lines: [line], deliveryDate: new Date() });
      const invA2 = await createDraftInvoice(orgAId, { customerId: customerAId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", documentDiscountPermille: 0, documentDiscountCents: 0, documentChargePermille: 0, documentChargeCents: 0, lines: [line], deliveryDate: new Date() });
      await dbInternal.$transaction((tx) =>
        linkDocuments(tx, { orgId: orgAId, fromType: "INVOICE", fromId: invA1.id, toType: "INVOICE", toId: invA2.id, relationType: "CORRECTS" }),
      );

      const seenByOwner = await listRelations(orgAId, "INVOICE", invA1.id);
      expect(seenByOwner).toHaveLength(1);

      const seenByOtherOrg = await listRelations(orgBId, "INVOICE", invA1.id);
      expect(seenByOtherOrg).toHaveLength(0);
    });
  });
});
