/**
 * C1 (Fix-Welle Final-Review Phase 12b): die Phase-12b-Blocker in validateMandatoryFields
 * (BR-IC-11-Datum, IG_LIEFERUNG-EU-Praefix, REVERSE_CHARGE-USt-IdNr., AUSFUHR-Land/
 * -Aussteller-USt-IdNr.) sowie die verschaerfte Hinweis-Regexpruefung duerfen den
 * Storno-/Teilgutschrift-Pfad (cancel.ts/credit.ts) fuer BESTANDSBELEGE nicht sperren —
 * das waere der einzige GoBD-konforme Korrekturweg (Lastenheft § 51).
 *
 * Diese Tests legen den "Original"-Beleg DIREKT ueber dbInternal als bereits
 * FINALIZED an (statt ueber finalizeInvoice), um einen Bestandsbeleg zu simulieren, der
 * VOR den Phase-12b-Verschaerfungen wirksam festgeschrieben wurde: Alt-Hinweistext,
 * fehlendes Leistungsdatum, fehlende Empfaenger-/Aussteller-USt-IdNr. Genau dieser
 * Zustand ist per Definition nicht mehr ueber finalizeInvoice() (mit den heutigen,
 * strengeren Regeln) erreichbar — direktes Anlegen ist der einzige Weg, ihn zu testen.
 * dbInternal ist der ungeschuetzte Client (kein GoBD-Guard-Verstoss: der Guard in
 * src/lib/db.ts schuetzt vor UPDATE/DELETE an bereits festgeschriebenen Rechnungen, nicht
 * vor Testaufbau per CREATE — dasselbe Muster wie test/integration/cancel-credit-linetypes.test.ts).
 * sellerSnapshotJson/buyerSnapshotJson bleiben Platzhalter ("{}") — cancel.ts/credit.ts
 * uebernehmen sie unveraendert (inheritSnapshotFrom), ihr Inhalt ist fuer diesen Test
 * (Erfolg/Fehlschlag des Festschreibens) ohne Bedeutung.
 *
 * Eigenes Testjahr (2047): bislang von keiner anderen Testdatei verwendet — Invoice.number
 * ist global @unique (nicht je Org, siehe CLAUDE.md).
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { createPartialCreditNote } from "@/domain/invoice/credit";
import { finalizeInvoice, FinalizeError } from "@/domain/invoice/finalize";
import { createDraftInvoice } from "@/domain/invoice/create";
import { createInvoiceSchema } from "@/schemas";

const NOW = new Date("2047-05-01T10:00:00.000Z");
// Eigenes Jahr fuer orgNoVat: assignDocumentNumber() vergibt Nummern "RE-<Jahr>-000N" je Org
// NEU beginnend bei 1 — ein zweiter Jahrgang vermeidet die (bekannte, CLAUDE.md dokumentierte)
// globale @unique-Kollision zwischen den Nummernkreisen zweier verschiedener Test-Orgs im
// selben Jahr.
const NOW2 = new Date("2048-05-01T10:00:00.000Z");

let orgWithVat: string; // USt-IdNr. UND Steuernummer gesetzt
let orgNoVat: string; // nur Steuernummer, keine USt-IdNr. (Kleinunternehmer/Ausfuhr-Szenario)
let customerNoVat: string; // Empfaenger ohne USt-IdNr., unter orgWithVat (Reverse Charge)
let customerEu: string; // Empfaenger mit gueltiger EU-USt-IdNr., unter orgWithVat (ig. Lieferung)
let customerNoVat2: string; // Empfaenger ohne USt-IdNr., unter orgNoVat (Kleinunternehmer)
let customerEu2: string; // Empfaenger mit gueltiger EU-USt-IdNr., unter orgNoVat (Ausfuhr-EU-Fall)

let seq = 0;
function legacyNumber(prefix: string): string {
  seq += 1;
  return `RE-LEGACY-C1-${prefix}-${seq}`;
}

beforeAll(async () => {
  const withVat = await dbInternal.organization.create({
    data: { legalName: "C1 Storno GmbH", addressLine1: "Teststr. 1", postalCode: "10115", city: "Berlin", vatId: "DE111222333", taxNumber: "11/111/11111" },
  });
  orgWithVat = withVat.id;
  await ensureOrgMasterdata(dbInternal, orgWithVat);

  const noVat = await dbInternal.organization.create({
    data: { legalName: "C1 Kleinunternehmer GmbH", addressLine1: "Teststr. 2", postalCode: "10117", city: "Berlin", vatId: null, taxNumber: "22/222/22222" },
  });
  orgNoVat = noVat.id;
  await ensureOrgMasterdata(dbInternal, orgNoVat);

  const custNoVat = await dbInternal.customer.create({
    data: { orgId: orgWithVat, name: "Kunde ohne USt-IdNr.", addressLine1: "Kundenweg 1", postalCode: "20095", city: "Hamburg", type: "BUSINESS", countryCode: "DE" },
  });
  customerNoVat = custNoVat.id;

  const custEu = await dbInternal.customer.create({
    data: { orgId: orgWithVat, name: "EU Kunde BV", addressLine1: "Keizersgracht 1", postalCode: "1015", city: "Amsterdam", type: "BUSINESS", countryCode: "BE", vatId: "BE0123456789" },
  });
  customerEu = custEu.id;

  const custNoVat2 = await dbInternal.customer.create({
    data: { orgId: orgNoVat, name: "Kunde ohne USt-IdNr. 2", addressLine1: "Kundenweg 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", countryCode: "DE" },
  });
  customerNoVat2 = custNoVat2.id;

  const custEu2 = await dbInternal.customer.create({
    data: { orgId: orgNoVat, name: "EU Kunde BV 2", addressLine1: "Keizersgracht 2", postalCode: "1015", city: "Amsterdam", type: "BUSINESS", countryCode: "BE", vatId: "BE0987654321" },
  });
  customerEu2 = custEu2.id;
});

/** Legt einen bereits FINALIZED-Beleg direkt an (simuliert einen Bestandsbeleg). */
async function createLegacyFinalizedInvoice(opts: {
  orgId: string;
  customerId: string;
  taxScheme: string;
  notes: string;
  deliveryDate?: Date | null;
  deliveryStart?: Date | null;
  deliveryEnd?: Date | null;
  taxRate?: number;
  taxCategory: string;
}) {
  return dbInternal.invoice.create({
    data: {
      orgId: opts.orgId,
      customerId: opts.customerId,
      number: legacyNumber(opts.taxScheme.slice(0, 2)),
      status: "FINALIZED",
      type: "INVOICE",
      taxScheme: opts.taxScheme,
      issueDate: NOW,
      deliveryDate: opts.deliveryDate ?? null,
      deliveryStart: opts.deliveryStart ?? null,
      deliveryEnd: opts.deliveryEnd ?? null,
      notes: opts.notes,
      netTotalCents: 10000,
      taxTotalCents: 0,
      grossTotalCents: 10000,
      taxBreakdownJson: JSON.stringify([{ taxCategory: opts.taxCategory, taxRate: opts.taxRate ?? 0, netCents: 10000, taxCents: 0 }]),
      sellerSnapshotJson: "{}",
      buyerSnapshotJson: "{}",
      snapshotSource: "MIGRATION",
      snapshotAt: NOW,
      lines: {
        create: [
          { position: 1, description: "Alt-Position", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: opts.taxRate ?? 0, taxCategory: opts.taxCategory, lineNetCents: 10000 },
        ],
      },
    },
  });
}

describe("Storno von Bestandsbelegen (C1) — die vier neuen Phase-12b-Blocker sperren cancelInvoice nicht", () => {
  it("REVERSE_CHARGE ohne Empfaenger-USt-IdNr.", async () => {
    const original = await createLegacyFinalizedInvoice({
      orgId: orgWithVat,
      customerId: customerNoVat,
      taxScheme: "REVERSE_CHARGE",
      notes: "Steuerschuldnerschaft des Leistungsempfängers",
      deliveryDate: NOW,
      taxCategory: "AE",
    });
    const res = await cancelInvoice(original.id, { now: NOW });
    expect(res.creditNote.status).toBe("FINALIZED");
    const updated = await dbInternal.invoice.findUnique({ where: { id: original.id } });
    expect(updated?.status).toBe("CANCELLED");
  });

  it("IG_LIEFERUNG mit Alt-Hinweistext und ohne Leistungsdatum/-zeitraum (BR-IC-11)", async () => {
    const original = await createLegacyFinalizedInvoice({
      orgId: orgWithVat,
      customerId: customerEu,
      taxScheme: "IG_LIEFERUNG",
      notes: "Steuerfreie Lieferung nach Absprache", // Alt-Hinweistext, erfuellt die neue Regex nicht
      deliveryDate: null,
      taxCategory: "K",
    });
    const res = await cancelInvoice(original.id, { now: NOW });
    expect(res.creditNote.status).toBe("FINALIZED");
  });

  it("KLEINUNTERNEHMER mit Alt-Hinweistext (ohne '19')", async () => {
    const original = await createLegacyFinalizedInvoice({
      orgId: orgNoVat,
      customerId: customerNoVat2,
      taxScheme: "KLEINUNTERNEHMER",
      notes: "Kleinunternehmer, kein Ausweis von Umsatzsteuer", // Erst-Wort-Heuristik-Text
      deliveryDate: NOW2,
      taxCategory: "E",
    });
    const res = await cancelInvoice(original.id, { now: NOW2 });
    expect(res.creditNote.status).toBe("FINALIZED");
  });

  it("AUSFUHR mit EU-Empfaenger und ohne Aussteller-USt-IdNr.", async () => {
    const original = await createLegacyFinalizedInvoice({
      orgId: orgNoVat,
      customerId: customerEu2, // EU-Adresse statt Drittland — vor Phase 12b nicht geprueft
      taxScheme: "AUSFUHR",
      notes: "Steuerfreie Ausfuhrlieferung",
      deliveryDate: NOW2,
      taxCategory: "G",
    });
    const res = await cancelInvoice(original.id, { now: NOW2 });
    expect(res.creditNote.status).toBe("FINALIZED");
  });
});

describe("Teilgutschrift von Bestandsbelegen (C1) — credit.ts ist ebenso befreit", () => {
  it("REVERSE_CHARGE ohne Empfaenger-USt-IdNr.: Teilgutschrift gelingt", async () => {
    const original = await createLegacyFinalizedInvoice({
      orgId: orgWithVat,
      customerId: customerNoVat,
      taxScheme: "REVERSE_CHARGE",
      notes: "Steuerschuldnerschaft des Leistungsempfängers",
      deliveryDate: NOW,
      taxCategory: "AE",
    });
    const res = await createPartialCreditNote(
      original.id,
      { lines: [{ description: "Teilrueckgabe", quantityMilli: 500, unitNetPriceCents: 10000, taxRate: 0, taxCategory: "AE" }] },
      { now: NOW },
    );
    expect(res.creditNote.status).toBe("FINALIZED");
  });
});

describe("Frische Belege bleiben blockiert (Gegenprobe zu C1)", () => {
  it("ein NEU angelegter REVERSE_CHARGE-Entwurf ohne Empfaenger-USt-IdNr. laesst sich nicht festschreiben", async () => {
    const draft = await createDraftInvoice(
      orgWithVat,
      createInvoiceSchema.parse({
        customerId: customerNoVat,
        type: "INVOICE",
        taxScheme: "REVERSE_CHARGE",
        currency: "EUR",
        deliveryDate: NOW,
        notes: "Steuerschuldnerschaft des Leistungsempfängers",
        lines: [{ description: "Leistung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 0, taxCategory: "AE", discountPermille: 0, discountCents: 0 }],
      }),
      { now: NOW },
    );
    await expect(finalizeInvoice(draft.id, { now: NOW })).rejects.toThrow(FinalizeError);
  });
});
