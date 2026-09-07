/**
 * Phase 8b, Task 1: Zahlungsnotiz, wiederkehrende Rechnungen — DAY-Intervall,
 * maxRuns, emailTemplateId beim autoSend.
 *
 * Eigenes Jahr (2064, Plan-Header) fuer die Nummernvergabe — "Invoice.number" ist
 * global @unique und test.db wird ueber die gesamte Testlaufzeit geteilt (siehe
 * Kommentar in payment-skonto.test.ts).
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { saveMailSettings } from "@/domain/email/settings";
import { saveEmailTemplate } from "@/domain/email/templates";
import { createMemoryProvider } from "@/lib/mail/memory";
import { createRecurring } from "@/domain/recurring/create";
import { emitRecurringNow, runDueRecurring } from "@/domain/recurring/run";
import { recordPaymentSchema, type CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
let n = 0;
const FIX_DATE = new Date("2064-06-09T10:00:00.000Z");

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Zahlung/Abo Test GmbH",
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
  await ensureOrgMasterdata(dbInternal, orgId);
  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Zahlung/Abo Test GmbH",
    fromEmail: "rechnung@example.org",
    defaultCc: "",
    defaultBcc: "",
    copyToSelf: false,
  });
});

function makeCustomer(email: string) {
  n += 1;
  return dbInternal.customer.create({
    data: { orgId, name: `Abo-Kunde ${n} AG`, addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email },
  });
}

async function finalizedInvoice(): Promise<{ id: string; grossTotalCents: number }> {
  const input: CreateInvoiceInput = {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    issueDate: FIX_DATE,
    lines: [
      { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 100000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
    ],
  } as CreateInvoiceInput;
  const draft = await createDraftInvoice(orgId, input, { now: FIX_DATE });
  const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });
  return { id: fin.id, grossTotalCents: fin.grossTotalCents };
}

const line = { lineType: "ITEM" as const, description: "Wartung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 };

describe("recordPayment: Notiz", () => {
  it("note wird persistiert", async () => {
    const inv = await finalizedInvoice();
    const result = await recordPayment(
      inv.id,
      recordPaymentSchema.parse({ amountCents: 1000, method: "TRANSFER", note: "Per Scheck, Kunde meldete sich telefonisch" }),
    );
    const stored = await dbInternal.payment.findFirst({ where: { invoiceId: inv.id } });
    expect(stored?.note).toBe("Per Scheck, Kunde meldete sich telefonisch");
    expect(result.payment.paidAmountCents).toBe(1000);
  });

  it("note ist optional (bleibt NULL ohne Angabe)", async () => {
    const inv = await finalizedInvoice();
    await recordPayment(inv.id, recordPaymentSchema.parse({ amountCents: 500, method: "TRANSFER" }));
    const stored = await dbInternal.payment.findFirst({ where: { invoiceId: inv.id } });
    expect(stored?.note).toBeNull();
  });
});

describe("Recurring: DAY-Intervall", () => {
  it("DAY x 10: naechster Lauf +10 Tage", async () => {
    const customer = await makeCustomer("day-interval@example.org");
    const rec = await createRecurring(orgId, {
      customerId: customer.id,
      title: "Taegliches Abo",
      interval: "DAY",
      intervalCount: 10,
      startDate: new Date("2064-07-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      lines: [line],
    });
    expect(rec.nextRunDate.toISOString().slice(0, 10)).toBe("2064-07-01");

    const emitted = await emitRecurringNow(rec.id, { now: new Date("2064-07-01T10:00:00.000Z") });
    expect(emitted.invoiceId).toBeTruthy();

    const updated = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: rec.id } });
    expect(updated.nextRunDate.toISOString().slice(0, 10)).toBe("2064-07-11"); // +10 Tage
    expect(updated.issuedCount).toBe(1);
  });
});

describe("Recurring: maxRuns", () => {
  it("maxRuns 2: nach dem zweiten Lauf ENDED, kein dritter Lauf", async () => {
    const customer = await makeCustomer("max-runs@example.org");
    const rec = await createRecurring(orgId, {
      customerId: customer.id,
      title: "Abo mit Laufbegrenzung",
      interval: "MONTHLY",
      intervalCount: 1,
      maxRuns: 2,
      startDate: new Date("2064-08-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      lines: [line],
    });

    const summaries = await runDueRecurring({ now: new Date("2065-01-01T10:00:00.000Z"), orgId, maxPerAbo: 10 });
    const summary = summaries.find((s) => s.recurringId === rec.id)!;
    // Faellig bis 2065-01-01 waeren eigentlich mehr als 2 Monatslaeufe (Aug-Dez) —
    // maxRuns=2 bricht den Batch-Lauf nach dem zweiten Lauf ab (ended=true -> break).
    expect(summary.emitted).toHaveLength(2);

    const updated = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: rec.id } });
    expect(updated.status).toBe("ENDED");
    expect(updated.issuedCount).toBe(2);

    // Ein weiterer manueller Lauf darf jetzt nicht mehr moeglich sein (Abo ist ENDED).
    await expect(emitRecurringNow(rec.id, { now: new Date("2065-02-01T10:00:00.000Z") })).rejects.toThrow();
  });
});

// Fix-Welle Phase 8b (Nit): Reaktivierung eines wegen maxRuns beendeten Abos ohne
// gleichzeitige maxRuns-Erhoehung wuerde beim naechsten Lauf sofort wieder auf ENDED
// zurueckfallen (stiller Zyklus) — updateRecurringInvoke lehnt das jetzt mit einer
// klaren Fehlermeldung ab (409 auf Routen-Ebene). logActivity UPDATED wird ausserdem
// bei jeder erfolgreichen Aenderung geschrieben (vorher keinerlei Timeline-Eintrag fuer
// Abo-Bearbeitungen).
describe("Recurring: Reaktivierung aus ENDED (maxRuns) + logActivity UPDATED", () => {
  it("ACTIVE aus ENDED mit issuedCount >= maxRuns wird abgelehnt (InvalidOperationError)", async () => {
    const customer = await makeCustomer("reactivate-blocked@example.org");
    const rec = await createRecurring(orgId, {
      customerId: customer.id,
      title: "Abo Reaktivierung blockiert",
      interval: "MONTHLY",
      intervalCount: 1,
      maxRuns: 2,
      startDate: new Date("2064-08-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      lines: [line],
    });
    await runDueRecurring({ now: new Date("2065-01-01T10:00:00.000Z"), orgId, maxPerAbo: 10 });
    const ended = await dbInternal.recurringInvoice.findUniqueOrThrow({ where: { id: rec.id } });
    expect(ended.status).toBe("ENDED");

    const { updateRecurringInvoice } = await import("@/domain/recurring/update");
    await expect(updateRecurringInvoice(orgId, rec.id, { status: "ACTIVE" })).rejects.toThrow(/reaktiviert/);

    // Mit gleichzeitiger maxRuns-Erhoehung ist die Reaktivierung erlaubt.
    const reactivated = await updateRecurringInvoice(orgId, rec.id, { status: "ACTIVE", maxRuns: 5 });
    expect(reactivated.status).toBe("ACTIVE");
  });

  it("updateRecurringInvoice schreibt einen ActivityLog-Eintrag UPDATED fuer RECURRING", async () => {
    const customer = await makeCustomer("recurring-activity@example.org");
    const rec = await createRecurring(orgId, {
      customerId: customer.id,
      title: "Abo Activity-Test",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2064-08-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      lines: [line],
    });
    const { updateRecurringInvoice } = await import("@/domain/recurring/update");
    await updateRecurringInvoice(orgId, rec.id, { title: "Abo Activity-Test (geaendert)" }, "tester");

    const activity = await dbInternal.activityLog.findFirst({ where: { orgId, entityType: "RECURRING", entityId: rec.id, type: "UPDATED" } });
    expect(activity).not.toBeNull();
    expect(activity?.actor).toBe("tester");
  });
});

describe("Recurring: autoSend nutzt emailTemplateId", () => {
  it("verwendet die auf dem Abo hinterlegte Vorlage statt der Standardvorlage", async () => {
    const customer = await makeCustomer("autosend-template@example.org");
    const template = await saveEmailTemplate(orgId, {
      name: "Abo-Sondervorlage",
      docType: "INVOICE",
      subject: "Ihre Sonderrechnung (Sondervorlage)",
      body: "Sehr geehrte Damen und Herren, anbei die Sonderrechnung.",
      isDefault: false,
    });

    const rec = await createRecurring(orgId, {
      customerId: customer.id,
      title: "Abo mit eigener Vorlage",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: new Date("2064-09-01T10:00:00.000Z"),
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: true,
      autoSend: true,
      emailTemplateId: template.id,
      lines: [line],
    });

    const provider = createMemoryProvider();
    const now = rec.nextRunDate; // zeitzonenfest (12:00 Ortszeit, s. scheduler.test.ts)
    const summaries = await runDueRecurring({ now, orgId, provider });
    const summary = summaries.find((s) => s.recurringId === rec.id)!;
    expect(summary.emitted).toHaveLength(1);
    expect(summary.emitted[0]!.emailStatus).toBe("SENT");

    const log = await dbInternal.emailLog.findFirst({ where: { orgId, docId: summary.emitted[0]!.invoiceId, status: "SENT" } });
    expect(log).not.toBeNull();
    expect(log?.templateId).toBe(template.id);
    expect(log?.subject).toContain("Ihre Sonderrechnung");
  });
});
