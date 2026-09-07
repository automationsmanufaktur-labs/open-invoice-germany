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
import { computeLineNet } from "@/lib/pricing/line";
import { computeTaxBreakdown } from "@/lib/tax";
import { assignDocumentNumber } from "@/domain/numbering/ranges";
import { buildSellerSnapshot, buildContactSnapshot } from "@/domain/snapshot";
import { resolveBuyerSnapshot } from "@/domain/document/snapshot-input";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { normalizeLines } from "@/domain/document/lines";
import { loadDocumentSettings } from "@/domain/document/settings";
import { createDocumentSchema, type SnapshotSource } from "@/schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  // normalizeLines (Lastenheft §8, zweite Verteidigungslinie neben Zod): Positionsnummern +
  // erzwungene Null-Betraege bei Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL).
  const normalized = normalizeLines(input.lines);
  const lines = normalized.map((l) => ({
    position: l.position,
    lineType: l.lineType,
    description: l.description,
    descriptionLong: l.descriptionLong,
    articleNumber: l.articleNumber,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
    unitNetPriceCents: l.unitNetPriceCents,
    taxRate: l.taxRate,
    taxCategory: l.taxCategory,
    discountPermille: l.discountPermille,
    discountCents: l.discountCents,
    lineNetCents: l.lineType === "ITEM" ? computeLineNet(l).lineNetCents : 0,
  }));
  // Nicht-ITEM-Zeilen gehen nie in Summen/Steuerberechnung ein (§8).
  const itemLines = lines.filter((l) => l.lineType === "ITEM");

  const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
  if (!customer) throw new Error("Kunde nicht gefunden.");
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });

  // Fix-Runde 1: org- UND kundengeprueft — Ansprechpartner/Rechnungsadresse muessen zum
  // ausgewaehlten Kunden gehoeren, sonst koennte ein fremder Ansprechpartner/eine fremde
  // Adresse (anderer Kunde derselben Org) unbemerkt uebernommen werden.
  //
  // Phase 8a (§29/§30): fehlt die Angabe komplett (`undefined`), greift die
  // Default-Adresse/der Default-Ansprechpartner des Kunden — analog
  // createDraftInvoiceWithinTx. Explizites `null` uebernimmt bewusst keinen Default.
  let contactPersonId = input.contactPersonId;
  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId, customerId: input.customerId } });
    if (!contact) throw new Error("Ansprechpartner nicht gefunden.");
  } else if (contactPersonId === undefined) {
    const defaultContact = await tx.contactPerson.findFirst({ where: { orgId, customerId: input.customerId, isDefault: true }, select: { id: true } });
    contactPersonId = defaultContact?.id ?? null;
  }
  let billingAddressId = input.billingAddressId;
  if (billingAddressId) {
    const address = await tx.customerAddress.findFirst({ where: { id: billingAddressId, orgId, customerId: input.customerId } });
    if (!address) throw new Error("Rechnungsadresse nicht gefunden.");
  } else if (billingAddressId === undefined) {
    const defaultAddress = await tx.customerAddress.findFirst({ where: { orgId, customerId: input.customerId, type: "BILLING", isDefault: true }, select: { id: true } });
    billingAddressId = defaultAddress?.id ?? null;
  }

  const docType = input.kind;
  // B3 (Final-Review): ueber assignDocumentNumber() — siehe invoice/finalize.ts.
  const number = await assignDocumentNumber(tx, orgId, docType, now);

  // Fehlende Texte/Bedingungen: Eingabe > Kunden-Text (nur Liefer-/Zahlungsbedingungen,
  // §28) > Textvorlage der Organisation (Selbstheilung) — der Beleg speichert den Text,
  // kein Live-Bezug auf Kunde oder Vorlage.
  const headerText = input.headerText ?? (await pickTextTemplate(tx, orgId, docType, "HEAD"));
  const footerText = input.footerText ?? (await pickTextTemplate(tx, orgId, docType, "FOOT"));
  const deliveryTerms = input.deliveryTerms ?? customer.deliveryTermsText ?? (await pickTextTemplate(tx, orgId, docType, "TERMS_DELIVERY"));
  const paymentTerms = input.paymentTerms ?? customer.paymentTermsText ?? (await pickTextTemplate(tx, orgId, docType, "TERMS_PAYMENT"));

  const buyerSnapshot = await resolveBuyerSnapshot(tx, orgId, customer, contactPersonId, billingAddressId);
  // Ansprechpartner-Snapshot (§30): NUR gesetzt, wenn tatsaechlich ein Ansprechpartner
  // gewaehlt/vorbelegt wurde — kein Ansprechpartner bleibt strukturell `null`.
  let contactSnapshotJson: string | null = null;
  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId } });
    if (contact) {
      contactSnapshotJson = JSON.stringify(
        buildContactSnapshot({ firstName: contact.firstName, lastName: contact.lastName, role: contact.role, email: contact.email, phone: contact.phone }),
      );
    }
  }

  const settings = await loadDocumentSettings(orgId);

  // Rabatt (§28): Eingabe > Customer.defaultDiscountPermille, nur wenn BEIDE
  // Rabattfelder fehlen (Task-2-Facts, wie createDraftInvoiceWithinTx).
  const hasExplicitDiscount = input.documentDiscountPermille !== undefined || input.documentDiscountCents !== undefined;
  const documentDiscountPermille = hasExplicitDiscount ? (input.documentDiscountPermille ?? 0) : (customer.defaultDiscountPermille ?? 0);
  const documentDiscountCents = hasExplicitDiscount ? (input.documentDiscountCents ?? 0) : 0;

  // Bestellreferenz (§28): Eingabe > Customer.orderReference. Quote kennt kein eigenes
  // orderNumber-Feld — die Kundenreferenz belegt `customerReference` vor (BT-13-Aequivalent
  // fuer Geschaeftsdokumente, siehe Invoice.orderNumber).
  const customerReference = input.customerReference ?? customer.orderReference ?? undefined;

  // quoteValidityDays (Phase 7, §33): fehlt `validUntil` bei einem Angebot, wird es aus
  // Ausstellungsdatum + Org-Einstellung vorbelegt.
  let validUntil = input.validUntil;
  if (!validUntil && input.kind === "ANGEBOT") {
    validUntil = new Date(now.getTime() + settings.quoteValidityDays * DAY_MS);
  }

  // Waehrung (§28): Eingabe > Customer.defaultCurrency > DocumentSettings.defaultCurrency.
  const currency = input.currency ?? customer.defaultCurrency ?? settings.defaultCurrency ?? "EUR";

  const totals = computeTaxBreakdown(
    itemLines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    {
      discountPermille: documentDiscountPermille,
      discountCents: documentDiscountCents,
      chargePermille: input.documentChargePermille,
      chargeCents: input.documentChargeCents,
    },
  );

  const snapshotSource: SnapshotSource = "CREATE";
  const doc = await tx.quote.create({
    data: {
      orgId,
      customerId: input.customerId,
      kind: input.kind,
      number,
      status: "DRAFT",
      issueDate: now,
      validUntil,
      currency,
      taxScheme: input.taxScheme,
      subject: input.subject,
      notes: input.notes,
      internalNotes: input.internalNotes,
      headerText,
      footerText,
      deliveryTerms,
      paymentTerms,
      customerReference,
      contactPersonId,
      billingAddressId,
      documentDiscountPermille,
      documentDiscountCents,
      documentChargePermille: input.documentChargePermille,
      documentChargeCents: input.documentChargeCents,
      documentChargeReason: input.documentChargeReason,
      sellerSnapshotJson: JSON.stringify(buildSellerSnapshot(org)),
      buyerSnapshotJson: JSON.stringify(buyerSnapshot),
      contactSnapshotJson,
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
  await logActivity(tx, { orgId, entityType: "QUOTE", entityId: doc.id, type: "CREATED", actor, at: now, data: { kind: input.kind, number } });

  return doc;
}

export async function createBusinessDocument(orgId: string, rawInput: unknown, opts: CreateDocumentOptions = {}) {
  return dbInternal.$transaction((tx) => createBusinessDocumentWithinTx(tx, orgId, rawInput, opts));
}
