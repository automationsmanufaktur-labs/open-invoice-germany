import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma, dbInternal, GobdImmutabilityError } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { createPartialCreditNote } from "@/domain/invoice/credit";
import { recordPayment } from "@/domain/invoice/payment";
import { createDunning } from "@/domain/dunning/create";
import { createRecurring } from "@/domain/recurring/create";
import { emitRecurringNow, runDueRecurring } from "@/domain/recurring/run";
import { createBusinessDocument } from "@/domain/document/create";
import { convertDocumentToInvoice } from "@/domain/document/convert";
import { verifyChain, type ChainEntry } from "@/domain/changelog";
import { createDocumentSchema, recordPaymentSchema, type CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
const FIX_DATE = new Date("2026-06-09T10:00:00.000Z");

beforeAll(async () => {
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
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

function baseInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: new Date("2026-06-01"),
    lines: [
      { description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 },
    ],
    ...extra,
  } as CreateInvoiceInput;
}

const seqOf = (number: string | null) => Number(number!.split("-").pop());

describe("GoBD: Nummernkreis + Unveränderbarkeit", () => {
  it("Entwurf hat keine Nummer; Festschreiben vergibt fortlaufend & monoton", async () => {
    const d1 = await createDraftInvoice(orgId, baseInput());
    expect(d1.number).toBeNull();

    const f1 = await finalizeInvoice(d1.id, { now: FIX_DATE });
    const f2 = await finalizeInvoice((await createDraftInvoice(orgId, baseInput())).id, { now: FIX_DATE });

    expect(f1.number).toMatch(/^RE-2026-\d{4}$/);
    expect(seqOf(f2.number)).toBe(seqOf(f1.number) + 1);
    // Summen-Snapshot: 2 h * 100 € = 200 € netto, 19 % = 38 €, brutto 238 €
    expect(f1.netTotalCents).toBe(20000);
    expect(f1.taxTotalCents).toBe(3800);
    expect(f1.grossTotalCents).toBe(23800);
  });

  it("verworfene Entwürfe verbrauchen KEINE Nummer (kein Loch)", async () => {
    const before = await finalizeInvoice((await createDraftInvoice(orgId, baseInput())).id, { now: FIX_DATE });

    const discarded = await createDraftInvoice(orgId, baseInput());
    await prisma.invoice.delete({ where: { id: discarded.id } }); // erlaubt: Entwurf

    const after = await finalizeInvoice((await createDraftInvoice(orgId, baseInput())).id, { now: FIX_DATE });
    expect(seqOf(after.number)).toBe(seqOf(before.number) + 1);
  });

  it("blockt jede Änderung/Löschung festgeschriebener Rechnungen (Guard)", async () => {
    const fin = await finalizeInvoice((await createDraftInvoice(orgId, baseInput())).id, { now: FIX_DATE });

    await expect(prisma.invoice.update({ where: { id: fin.id }, data: { notes: "manipuliert" } })).rejects.toBeInstanceOf(
      GobdImmutabilityError,
    );
    await expect(prisma.invoice.delete({ where: { id: fin.id } })).rejects.toBeInstanceOf(GobdImmutabilityError);
    await expect(prisma.invoiceLine.deleteMany({ where: { invoiceId: fin.id } })).rejects.toBeInstanceOf(
      GobdImmutabilityError,
    );
  });

  it("erlaubt Änderung von Entwürfen", async () => {
    const draft = await createDraftInvoice(orgId, baseInput());
    const updated = await prisma.invoice.update({ where: { id: draft.id }, data: { notes: "ok" } });
    expect(updated.notes).toBe("ok");
  });

  it("storniert per Gutschrift; Original bleibt erhalten (Storno statt Löschung)", async () => {
    const fin = await finalizeInvoice((await createDraftInvoice(orgId, baseInput())).id, { now: FIX_DATE });
    const res = await cancelInvoice(fin.id, { now: FIX_DATE });

    expect(res.creditNote.type).toBe("CREDIT_NOTE");
    expect(res.creditNote.number).toMatch(/^GS-2026-\d{4}$/);
    // Betragsspiegelbild: Original + Storno = 0 (Gutschrift ist negativ)
    expect(res.creditNote.grossTotalCents).toBe(-fin.grossTotalCents);
    expect(fin.grossTotalCents + res.creditNote.grossTotalCents).toBe(0);

    const original = await prisma.invoice.findUnique({ where: { id: fin.id }, include: { lines: true } });
    expect(original!.status).toBe("CANCELLED");
    expect(original!.reversedByInvoiceId).toBe(res.creditNote.id);
    expect(original!.lines.length).toBeGreaterThan(0); // Original-Positionen unverändert vorhanden
  });

  it("hält die Audit-Hash-Chain der Organisation intakt", async () => {
    const rows = await prisma.changeLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      select: { prevHash: true, hash: true, entity: true, entityId: true, action: true, actor: true, at: true, diffJson: true },
    });
    const entries: ChainEntry[] = rows.map((r) => ({
      prevHash: r.prevHash,
      hash: r.hash,
      payload: {
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        actor: r.actor,
        at: r.at.toISOString(),
        diff: JSON.parse(r.diffJson),
      },
    }));
    expect(entries.length).toBeGreaterThan(3);
    expect(verifyChain(entries).valid).toBe(true);
  });

  it("Teilgutschrift: Original bleibt FINALIZED, Gutschrift ist negativ", async () => {
    const fin = await finalizeInvoice((await createDraftInvoice(orgId, baseInput())).id, { now: FIX_DATE });
    const res = await createPartialCreditNote(
      fin.id,
      { lines: [{ description: "Teilerstattung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S" }] },
      { now: FIX_DATE },
    );
    expect(res.creditNote.type).toBe("CREDIT_NOTE");
    expect(res.creditNote.grossTotalCents).toBe(-11900); // 100 € netto + 19 % = 119 €, negativ
    const original = await prisma.invoice.findUnique({ where: { id: fin.id } });
    expect(original!.status).toBe("FINALIZED"); // NICHT storniert
  });

  it("Dokument: Angebot anlegen + in Rechnung umwandeln", async () => {
    const doc = await createBusinessDocument(
      orgId,
      createDocumentSchema.parse({
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [{ description: "Pos", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0 }],
      }),
    );
    expect(doc.number).toMatch(/^AN-\d{4}-\d{4}$/);
    const inv = await convertDocumentToInvoice(doc.id);
    expect(inv.type).toBe("INVOICE");
    expect(inv.status).toBe("DRAFT");
    expect(inv.grossTotalCents).toBe(5950); // 50 € + 19 % = 59,50 €
    const q = await prisma.quote.findUnique({ where: { id: doc.id } });
    expect(q!.status).toBe("CONVERTED");
    expect(q!.convertedToInvoiceId).toBe(inv.id);
  });

  it("Zahlung + Mahnwesen: Teilzahlung → PARTIALLY_PAID, Mahnstufen mit Verzugszins", async () => {
    const draft = await createDraftInvoice(orgId, baseInput({ dueDate: new Date("2026-06-01") }));
    const fin = await finalizeInvoice(draft.id, { now: FIX_DATE }); // brutto 238,00 €
    const afterPay = await recordPayment(fin.id, recordPaymentSchema.parse({ amountCents: 10000, method: "TRANSFER", paidAt: FIX_DATE }));
    expect(afterPay.status).toBe("PARTIALLY_PAID");
    expect(afterPay.paidAmountCents).toBe(10000);

    const r0 = await createDunning(fin.id, { now: FIX_DATE });
    expect(r0.level).toBe(0); // Zahlungserinnerung, ohne Zins/Gebühr
    expect(r0.openAmountCents).toBe(13800); // 238 − 100 = 138 €
    expect(r0.dunning.number).toMatch(/^MA-\d{4}-\d{4}$/);
    expect(r0.dunning.interestAmountCents).toBe(0);

    const r1 = await createDunning(fin.id, { now: FIX_DATE });
    expect(r1.level).toBe(1); // 1. Mahnung -> Verzugszins + 40-€-Pauschale (B2B)
    expect(r1.dunning.interestAmountCents).toBeGreaterThan(0);
    expect(r1.dunning.flatFee40Cents).toBe(4000);
  });

  it("Abo: Lauf erzeugt Rechnung, schreibt nextRunDate fort, autoFinalize vergibt Nummer", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Wartungsvertrag Test",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2026-06-01T09:00:00"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: true,
      lines: [
        { description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 },
      ],
    });
    expect(rec.nextRunDate.toISOString().slice(0, 10)).toBe("2026-06-01");

    // Fälliger Stichtag (01.06.) liegt vor FIX_DATE (09.06.) → ein Beleg
    const summaries = await runDueRecurring({ now: FIX_DATE, orgId });
    const mine = summaries.find((s) => s.recurringId === rec.id);
    expect(mine).toBeDefined();
    expect(mine!.emitted).toHaveLength(1);
    const emitted = mine!.emitted[0];
    expect(emitted.finalized).toBe(true);
    expect(emitted.number).toMatch(/^RE-2026-\d{4}$/);

    const inv = await prisma.invoice.findUnique({ where: { id: emitted.invoiceId } });
    expect(inv!.status).toBe("FINALIZED");
    expect(inv!.grossTotalCents).toBe(11900); // 100 € + 19 %
    expect(inv!.recurringInvoiceId).toBe(rec.id);
    expect(inv!.deliveryDate!.toISOString().slice(0, 10)).toBe("2026-06-01"); // Leistungsdatum = Periode

    const after = await prisma.recurringInvoice.findUnique({ where: { id: rec.id } });
    expect(after!.issuedCount).toBe(1);
    expect(after!.nextRunDate.toISOString().slice(0, 10)).toBe("2026-07-01"); // fortgeschrieben
    expect(after!.status).toBe("ACTIVE");

    // Erneuter Lauf zum selben Stichtag erzeugt nichts (nextRunDate liegt jetzt in der Zukunft)
    const again = await runDueRecurring({ now: FIX_DATE, orgId });
    expect(again.find((s) => s.recurringId === rec.id)).toBeUndefined();

    // Manuelle Sofort-Abrechnung ignoriert den Stichtag (Entwurf, da kein autoFinalize? hier doch true)
    const manual = await emitRecurringNow(rec.id, { now: FIX_DATE });
    expect(manual.finalized).toBe(true);
    const after2 = await prisma.recurringInvoice.findUnique({ where: { id: rec.id } });
    expect(after2!.issuedCount).toBe(2);
    expect(after2!.nextRunDate.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("Abo: endet automatisch nach dem letzten Stichtag", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Befristetes Abo",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2026-05-01T09:00:00"),
      endDate: new Date("2026-05-15T09:00:00"), // nur ein Lauf, danach > endDate
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      lines: [
        { description: "Pos", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19, taxCategory: "S", discountPermille: 0 },
      ],
    });
    const summaries = await runDueRecurring({ now: FIX_DATE, orgId, maxPerAbo: 12 });
    const mine = summaries.find((s) => s.recurringId === rec.id);
    expect(mine!.emitted).toHaveLength(1); // nächster Stichtag (01.06.) > endDate → Stopp
    expect(mine!.emitted[0].finalized).toBe(false); // Entwurf
    const after = await prisma.recurringInvoice.findUnique({ where: { id: rec.id } });
    expect(after!.status).toBe("ENDED");
  });
});
