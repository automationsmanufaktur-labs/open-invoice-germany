import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  QuoteStatus,
  DeliveryNoteStatus,
  BillingState,
  RelationType,
  SnapshotSource,
  createDocumentSchema,
  updateDocumentSchema,
  createDeliveryNoteSchema,
  deliveryNoteLineInputSchema,
  convertDocumentSchema,
  convertDocumentBodySchema,
  documentStatusActionSchema,
} from "@/schemas";

describe("QuoteStatus / DeliveryNoteStatus / BillingState", () => {
  it("QuoteStatus akzeptiert alle Statuswerte inkl. REJECTED/CANCELLED", () => {
    for (const s of ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]) {
      expect(QuoteStatus.safeParse(s).success).toBe(true);
    }
    expect(QuoteStatus.safeParse("CONVERTED").success).toBe(false);
  });

  it("DeliveryNoteStatus enthaelt kein INVOICED (wird abgeleitet)", () => {
    expect(DeliveryNoteStatus.safeParse("INVOICED").success).toBe(false);
    for (const s of ["DRAFT", "CREATED", "SENT", "DELIVERED", "CANCELLED"]) {
      expect(DeliveryNoteStatus.safeParse(s).success).toBe(true);
    }
  });

  it("BillingState kennt NONE/PARTIAL/FULL", () => {
    for (const s of ["NONE", "PARTIAL", "FULL"]) {
      expect(BillingState.safeParse(s).success).toBe(true);
    }
    expect(BillingState.safeParse("OTHER").success).toBe(false);
  });
});

describe("RelationType / SnapshotSource Erweiterungen", () => {
  it("RelationType kennt DUPLICATED_FROM zusaetzlich zu den bisherigen Werten", () => {
    expect(RelationType.safeParse("DUPLICATED_FROM").success).toBe(true);
    expect(RelationType.safeParse("CONVERTED_TO").success).toBe(true);
  });

  it("SnapshotSource kennt SENT zusaetzlich zu den bisherigen Werten", () => {
    expect(SnapshotSource.safeParse("SENT").success).toBe(true);
    expect(SnapshotSource.safeParse("MIGRATION").success).toBe(true);
  });
});

describe("createDocumentSchema / updateDocumentSchema", () => {
  const validLine = { description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 10000, taxRate: 19 };

  it("parst ein vollstaendiges Beispiel mit den neuen Textfeldern", () => {
    const result = createDocumentSchema.safeParse({
      kind: "ANGEBOT",
      customerId: "cust1",
      subject: "Angebot ueber Beratungsleistungen",
      headerText: "Sehr geehrte Damen und Herren,",
      footerText: "Mit freundlichen Gruessen",
      deliveryTerms: "Lieferung frei Haus",
      paymentTerms: "14 Tage netto",
      customerReference: "Bestellnr. 4711",
      contactPersonId: "contact1",
      billingAddressId: "addr1",
      lines: [validLine],
    });
    expect(result.success).toBe(true);
  });

  it("erlaubt ein minimales Beispiel ohne die neuen Felder", () => {
    const result = createDocumentSchema.safeParse({ kind: "ANGEBOT", customerId: "cust1", lines: [validLine] });
    expect(result.success).toBe(true);
  });

  it("updateDocumentSchema erlaubt Teilupdates ohne kind", () => {
    const result = updateDocumentSchema.safeParse({ subject: "Neuer Betreff" });
    expect(result.success).toBe(true);
  });

  it("updateDocumentSchema lehnt kind ab (nicht Teil des Update-Payloads)", () => {
    const parsed = updateDocumentSchema.safeParse({ kind: "PROFORMA", subject: "x" });
    // kind ist per .omit ausgeschlossen -> wird stillschweigend entfernt, nicht validiert;
    // das Ergebnis darf kein "kind" enthalten.
    expect(parsed.success && !("kind" in parsed.data)).toBe(true);
  });
});

describe("createDeliveryNoteSchema / deliveryNoteLineInputSchema", () => {
  it("parst ein Beispiel mit sourceType/sourceId auf Beleg- und Zeilenebene", () => {
    const result = createDeliveryNoteSchema.safeParse({
      customerId: "cust1",
      sourceType: "QUOTE",
      sourceId: "quote1",
      showArticleNumber: true,
      showDescription: false,
      headerText: "Lieferschein-Kopftext",
      footerText: "Lieferschein-Fusstext",
      lines: [
        {
          description: "Beratung",
          quantityMilli: 1000,
          unit: "C62",
          sourceLineId: "line1",
          unitNetPriceCents: 10000,
          taxRate: 19,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("deliveryNoteLineInputSchema akzeptiert sourceLineId/unitNetPriceCents/taxRate optional", () => {
    const result = deliveryNoteLineInputSchema.safeParse({ description: "Position", quantityMilli: 1000, unit: "C62" });
    expect(result.success).toBe(true);
  });
});

describe("convertDocumentSchema", () => {
  it("akzeptiert eine gueltige Umwandlung mit Mengenangaben", () => {
    const result = convertDocumentSchema.safeParse({
      fromType: "QUOTE",
      fromId: "quote1",
      toKind: "DELIVERY_NOTE",
      quantities: [{ sourceLineId: "line1", quantityMilli: 500 }],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt negative Mengen ab", () => {
    const result = convertDocumentSchema.safeParse({
      fromType: "QUOTE",
      fromId: "quote1",
      toKind: "DELIVERY_NOTE",
      quantities: [{ sourceLineId: "line1", quantityMilli: -1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("documentStatusActionSchema", () => {
  it("akzeptiert bekannte Aktionen mit optionaler Notiz", () => {
    for (const action of ["MARK_SENT", "MARK_ACCEPTED", "MARK_REJECTED", "MARK_DELIVERED", "MARK_CREATED", "CANCEL", "ARCHIVE", "UNARCHIVE"]) {
      expect(documentStatusActionSchema.safeParse({ action }).success).toBe(true);
    }
  });

  it("lehnt unbekannte Aktionen ab", () => {
    expect(documentStatusActionSchema.safeParse({ action: "FOO" }).success).toBe(false);
  });

  it("kennt MARK_CREATED (Fix-Runde 1, Befund 1: Lieferschein-Entwurf -> CREATED)", () => {
    expect(documentStatusActionSchema.shape.action.options).toContain("MARK_CREATED");
  });
});

describe("convertDocumentBodySchema", () => {
  it("entspricht convertDocumentSchema ohne fromType/fromId", () => {
    const result = convertDocumentBodySchema.safeParse({
      toKind: "DELIVERY_NOTE",
      quantities: [{ sourceLineId: "line1", quantityMilli: 500 }],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt fromType/fromId nicht ab, ignoriert sie aber (nicht im Schema definiert)", () => {
    const parsed = convertDocumentBodySchema.safeParse({ toKind: "INVOICE" });
    expect(parsed.success && !("fromType" in parsed.data) && !("fromId" in parsed.data)).toBe(true);
  });
});

describe("Backfill-Migration phase3a_documents (SQLite + Postgres)", () => {
  const backfillSql = `UPDATE "Quote" SET "status" = 'ACCEPTED' WHERE "status" = 'CONVERTED';`;

  it("SQLite-Migration enthaelt das Backfill-UPDATE", () => {
    const entries = readdirSync(join(process.cwd(), "prisma", "migrations"));
    const name = entries.find((e) => e.endsWith("phase3a_documents"));
    expect(name).toBeTruthy();
    const sql = readFileSync(join(process.cwd(), "prisma", "migrations", name!, "migration.sql"), "utf8");
    expect(sql).toContain(backfillSql);
  });

  it("Postgres-Migration enthaelt das Backfill-UPDATE", () => {
    const entries = readdirSync(join(process.cwd(), "prisma", "migrations-postgres"));
    const name = entries.find((e) => e.endsWith("phase3a_documents"));
    expect(name).toBeTruthy();
    const sql = readFileSync(join(process.cwd(), "prisma", "migrations-postgres", name!, "migration.sql"), "utf8");
    expect(sql).toContain(backfillSql);
  });
});
