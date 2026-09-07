import { describe, it, expect } from "vitest";
import { invoiceLineInputSchema, createInvoiceSchema, updateInvoiceSchema, attachmentUploadSchema, MAX_ATTACHMENT_SIZE_BYTES } from "@/schemas";
import { normalizeLines, computeSubtotals } from "@/domain/document/lines";

describe("invoiceLineInputSchema — lineType-Refine (§8, kein Menge-0-Workaround)", () => {
  it("ITEM ohne lineType (Default) verhaelt sich wie bisher", () => {
    const result = invoiceLineInputSchema.safeParse({
      description: "Beratung",
      quantityMilli: 1000,
      unitNetPriceCents: 10000,
      taxRate: 19,
      taxCategory: "S",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lineType).toBe("ITEM");
  });

  it("ITEM mit Menge 0 wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      lineType: "ITEM",
      description: "Beratung",
      quantityMilli: 0,
      unitNetPriceCents: 10000,
      taxRate: 19,
    });
    expect(result.success).toBe(false);
  });

  it("HEADING mit Betrag 0 ist gueltig", () => {
    const result = invoiceLineInputSchema.safeParse({
      lineType: "HEADING",
      description: "Hosting",
      quantityMilli: 0,
      unitNetPriceCents: 0,
      taxRate: 0,
    });
    expect(result.success).toBe(true);
  });

  it("HEADING mit Menge != 0 wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      lineType: "HEADING",
      description: "Hosting",
      quantityMilli: 1000,
      unitNetPriceCents: 0,
      taxRate: 0,
    });
    expect(result.success).toBe(false);
  });

  it("TEXT mit Einzelpreis != 0 wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      lineType: "TEXT",
      description: "Hinweistext",
      quantityMilli: 0,
      unitNetPriceCents: 100,
      taxRate: 0,
    });
    expect(result.success).toBe(false);
  });

  it("SUBTOTAL mit Steuersatz != 0 wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      lineType: "SUBTOTAL",
      description: "Zwischensumme Hosting",
      quantityMilli: 0,
      unitNetPriceCents: 0,
      taxRate: 19,
    });
    expect(result.success).toBe(false);
  });

  it("SUBTOTAL mit Rabatt != 0 wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      lineType: "SUBTOTAL",
      description: "Zwischensumme Hosting",
      quantityMilli: 0,
      unitNetPriceCents: 0,
      taxRate: 0,
      discountPermille: 50,
    });
    expect(result.success).toBe(false);
  });

  it("descriptionLong > 5000 Zeichen wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      description: "Beratung",
      descriptionLong: "x".repeat(5001),
      quantityMilli: 1000,
      unitNetPriceCents: 10000,
      taxRate: 19,
    });
    expect(result.success).toBe(false);
  });

  it("articleNumber > 60 Zeichen wird abgelehnt", () => {
    const result = invoiceLineInputSchema.safeParse({
      description: "Beratung",
      articleNumber: "x".repeat(61),
      quantityMilli: 1000,
      unitNetPriceCents: 10000,
      taxRate: 19,
    });
    expect(result.success).toBe(false);
  });
});

describe("normalizeLines", () => {
  it("vergibt fortlaufende Positionsnummern ab 1", () => {
    const lines = normalizeLines([
      { description: "A", quantityMilli: 1000, unitNetPriceCents: 100, taxRate: 19, taxCategory: "S", unit: "C62", discountPermille: 0, discountCents: 0, lineType: "ITEM" },
      { description: "B", quantityMilli: 0, unitNetPriceCents: 0, taxRate: 0, taxCategory: "S", unit: "C62", discountPermille: 0, discountCents: 0, lineType: "HEADING" },
      { description: "C", quantityMilli: 2000, unitNetPriceCents: 200, taxRate: 19, taxCategory: "S", unit: "C62", discountPermille: 0, discountCents: 0, lineType: "ITEM" },
    ]);
    expect(lines.map((l) => l.position)).toEqual([1, 2, 3]);
  });

  it("setzt lineType-Default ITEM, wenn nicht angegeben", () => {
    const lines = normalizeLines([
      { description: "A", quantityMilli: 1000, unitNetPriceCents: 100, taxRate: 19, taxCategory: "S", unit: "C62", discountPermille: 0, discountCents: 0 } as never,
    ]);
    expect(lines[0].lineType).toBe("ITEM");
  });

  it("erzwingt Betraege 0 bei Nicht-ITEM, auch wenn im Input abweichend gesetzt", () => {
    const lines = normalizeLines([
      {
        description: "Hosting",
        lineType: "HEADING",
        quantityMilli: 5000, // fehlerhafter Input — soll auf 0 normalisiert werden
        unitNetPriceCents: 999,
        taxRate: 19,
        taxCategory: "S",
        unit: "C62",
        discountPermille: 100,
        discountCents: 50,
      },
    ]);
    expect(lines[0]).toMatchObject({
      quantityMilli: 0,
      unitNetPriceCents: 0,
      taxRate: 0,
      discountPermille: 0,
      discountCents: 0,
    });
  });

  it("laesst ITEM-Betraege unangetastet", () => {
    const lines = normalizeLines([
      {
        description: "Beratung",
        lineType: "ITEM",
        quantityMilli: 1000,
        unitNetPriceCents: 10000,
        taxRate: 19,
        taxCategory: "S",
        unit: "C62",
        discountPermille: 100,
        discountCents: 50,
      },
    ]);
    expect(lines[0]).toMatchObject({
      quantityMilli: 1000,
      unitNetPriceCents: 10000,
      taxRate: 19,
      discountPermille: 100,
      discountCents: 50,
    });
  });
});

describe("computeSubtotals", () => {
  // Lastenheft-Beispiel: Einrichtung (ITEM), Hosting (HEADING), zwei Hosting-Positionen
  // (ITEM), Zwischensumme Hosting (SUBTOTAL) — die Einrichtung darf NICHT einfliessen,
  // weil die HEADING-Zeile die laufende Summe zurueckgesetzt hat.
  it("summiert ITEM-Netto seit der letzten HEADING/SUBTOTAL-Zeile", () => {
    const lines = [
      { lineType: "ITEM" as const, lineNetCents: 50000 }, // Einrichtung, 500,00 €
      { lineType: "HEADING" as const, lineNetCents: 0 }, // Hosting
      { lineType: "ITEM" as const, lineNetCents: 24000 }, // Hosting 12 Monate, 240,00 €
      { lineType: "ITEM" as const, lineNetCents: 6000 }, // Domainverwaltung, 60,00 €
      { lineType: "SUBTOTAL" as const, lineNetCents: 0 }, // Zwischensumme Hosting
    ];
    const subtotals = computeSubtotals(lines);
    expect(subtotals).toEqual([0, 0, 0, 0, 30000]);
  });

  it("TEXT-Zeilen unterbrechen die laufende Summe nicht", () => {
    const lines = [
      { lineType: "ITEM" as const, lineNetCents: 10000 },
      { lineType: "TEXT" as const, lineNetCents: 0 },
      { lineType: "ITEM" as const, lineNetCents: 5000 },
      { lineType: "SUBTOTAL" as const, lineNetCents: 0 },
    ];
    expect(computeSubtotals(lines)).toEqual([0, 0, 0, 15000]);
  });

  it("mehrere Zwischensummen setzen jeweils zurueck", () => {
    const lines = [
      { lineType: "ITEM" as const, lineNetCents: 10000 },
      { lineType: "SUBTOTAL" as const, lineNetCents: 0 },
      { lineType: "ITEM" as const, lineNetCents: 3000 },
      { lineType: "SUBTOTAL" as const, lineNetCents: 0 },
    ];
    expect(computeSubtotals(lines)).toEqual([0, 10000, 0, 3000]);
  });

  it("leere Liste liefert leeres Ergebnis", () => {
    expect(computeSubtotals([])).toEqual([]);
  });
});

describe("createInvoiceSchema/updateInvoiceSchema — Kopffelder (Phase 4b)", () => {
  const baseLines = [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const }];

  it("createInvoiceSchema akzeptiert die neuen Kopffelder", () => {
    const result = createInvoiceSchema.safeParse({
      customerId: "cust-1",
      subject: "Angebot Website-Relaunch",
      orderNumber: "PO-4711",
      internalReference: "KST-100",
      contactPersonId: "cp-1",
      billingAddressId: "addr-1",
      shippingAddressId: "addr-2",
      lines: baseLines,
    });
    expect(result.success).toBe(true);
  });

  it("updateInvoiceSchema erlaubt ein Teil-Update ohne Pflichtfelder", () => {
    const result = updateInvoiceSchema.safeParse({ subject: "Neuer Betreff" });
    expect(result.success).toBe(true);
  });

  it("updateInvoiceSchema prueft die Skonto-Refine weiterhin", () => {
    const result = updateInvoiceSchema.safeParse({ skonto1Permille: 20 }); // ohne skonto1Days
    expect(result.success).toBe(false);
  });
});

describe("attachmentUploadSchema — Whitelist + Groessenobergrenze (§38)", () => {
  it("akzeptiert ein PDF innerhalb der Groessengrenze", () => {
    const result = attachmentUploadSchema.safeParse({ filename: "rechnung.pdf", mime: "application/pdf", sizeBytes: 1024 });
    expect(result.success).toBe(true);
  });

  it("lehnt einen nicht auf der Whitelist stehenden MIME-Typ ab", () => {
    const result = attachmentUploadSchema.safeParse({ filename: "script.exe", mime: "application/x-msdownload", sizeBytes: 1024 });
    expect(result.success).toBe(false);
  });

  it("lehnt Dateien groesser als 10 MB ab", () => {
    const result = attachmentUploadSchema.safeParse({ filename: "gross.pdf", mime: "application/pdf", sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1 });
    expect(result.success).toBe(false);
  });
});
