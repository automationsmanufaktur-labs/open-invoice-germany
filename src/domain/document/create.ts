/**
 * Erstellt ein Geschäftsdokument (Angebot / Auftragsbestätigung / Proforma).
 * KEIN GoBD-Beleg — bekommt eine Nummer aus dem kind-spezifischen Nummernkreis,
 * bleibt aber editierbar (keine Festschreibung/Unveränderbarkeit). Fehlende Kopf-/
 * Fusstexte und Bedingungen werden aus den Textvorlagen der Organisation vorbelegt
 * (Selbstheilung, src/domain/text-template) — der Text wird am Beleg gespeichert,
 * kein Live-Bezug auf die Vorlage.
 *
 * `createBusinessDocumentWithinTx` laeuft in einer vom Aufrufer uebergebenen
 * Transaktion (Muster: finalizeWithinTx in src/domain/invoice/finalize.ts) — so
 * lassen sich mehrere abhaengige Schreibvorgaenge (z. B. Statuswechsel + Konvertierung,
 * src/domain/document/convert.ts) atomar in EINER Transaktion zusammenfassen
 * (Lastenheft 50). `createBusinessDocument` bleibt der oeffentliche Einstieg fuer
 * Aufrufer ohne eigene Transaktion und wickelt sie selbst ein.
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { computeLineNetCents } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { defaultPrefix, formatDocumentNumber } from "@/domain/numbering";
import { buildSellerSnapshot } from "@/domain/snapshot";
import { resolveBuyerSnapshot } from "@/domain/document/snapshot-input";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { appendChangeLog } from "@/domain/audit";
import { createDocumentSchema, type SnapshotSource } from "@/schemas";

export interface CreateDocumentOptions {
  actor?: string;
  now?: Date;
}

export async function createBusinessDocumentWithinTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  rawInput: unknown,
  opts: CreateDocumentOptions = {},
) {
  const input = createDocumentSchema.parse(rawInput);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  const lines = input.lines.map((l, i) => ({
    position: i + 1,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
    unitNetPriceCents: l.unitNetPriceCents,
    taxRate: l.taxRate,
    taxCategory: l.taxCategory,
    discountPermille: l.discountPermille,
    lineNetCents: computeLineNetCents(l.quantityMilli, l.unitNetPriceCents, l.discountPermille),
  }));
  const totals = computeTaxBreakdown(
    lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
  );

  const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
  if (!customer) throw new Error("Kunde nicht gefunden.");
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });

  if (input.contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: input.contactPersonId, orgId } });
    if (!contact) throw new Error("Ansprechpartner nicht gefunden.");
  }
  if (input.billingAddressId) {
    const address = await tx.customerAddress.findFirst({ where: { id: input.billingAddressId, orgId } });
    if (!address) throw new Error("Rechnungsadresse nicht gefunden.");
  }

  const year = now.getFullYear();
  const docType = input.kind;
  const range = await tx.numberRange.upsert({
    where: { orgId_docType_year: { orgId, docType, year } },
    create: { orgId, docType, year, currentValue: 1, prefix: defaultPrefix(docType) },
    update: { currentValue: { increment: 1 } },
  });
  const number = formatDocumentNumber(range.pattern, {
    prefix: range.prefix || defaultPrefix(docType),
    seq: range.currentValue,
    padding: range.seqPadding,
    year,
    month: now.getMonth() + 1,
    day: now.getDate(),
  });

  // Fehlende Texte/Bedingungen aus den Textvorlagen der Organisation vorbelegen
  // (Selbstheilung) — der Beleg speichert den Text, kein Live-Bezug auf die Vorlage.
  const headerText = input.headerText ?? (await pickTextTemplate(tx, orgId, docType, "HEAD"));
  const footerText = input.footerText ?? (await pickTextTemplate(tx, orgId, docType, "FOOT"));
  const deliveryTerms = input.deliveryTerms ?? (await pickTextTemplate(tx, orgId, docType, "TERMS_DELIVERY"));
  const paymentTerms = input.paymentTerms ?? (await pickTextTemplate(tx, orgId, docType, "TERMS_PAYMENT"));

  const buyerSnapshot = await resolveBuyerSnapshot(tx, orgId, customer, input.contactPersonId, input.billingAddressId);

  const snapshotSource: SnapshotSource = "CREATE";
  const doc = await tx.quote.create({
    data: {
      orgId,
      customerId: input.customerId,
      kind: input.kind,
      number,
      status: "DRAFT",
      issueDate: now,
      validUntil: input.validUntil,
      currency: input.currency,
      taxScheme: input.taxScheme,
      subject: input.subject,
      notes: input.notes,
      internalNotes: input.internalNotes,
      headerText,
      footerText,
      deliveryTerms,
      paymentTerms,
      customerReference: input.customerReference,
      contactPersonId: input.contactPersonId,
      billingAddressId: input.billingAddressId,
      sellerSnapshotJson: JSON.stringify(buildSellerSnapshot(org)),
      buyerSnapshotJson: JSON.stringify(buyerSnapshot),
      snapshotSource,
      snapshotAt: now,
      netTotalCents: totals.netTotalCents,
      taxTotalCents: totals.taxTotalCents,
      grossTotalCents: totals.grossTotalCents,
      lines: { create: lines },
    },
    include: { lines: { orderBy: { position: "asc" } } },
  });

  await appendChangeLog(tx, {
    orgId,
    entity: "QUOTE",
    entityId: doc.id,
    action: "CREATE",
    actor,
    at: now,
    diff: { kind: input.kind, number, grossTotalCents: totals.grossTotalCents },
  });

  return doc;
}

export async function createBusinessDocument(orgId: string, rawInput: unknown, opts: CreateDocumentOptions = {}) {
  return dbInternal.$transaction((tx) => createBusinessDocumentWithinTx(tx, orgId, rawInput, opts));
}
