/**
 * Erstellt eine Rechnung als Entwurf (DRAFT). Berechnet Positions-Netto und
 * Steueraufschlüsselung, schreibt einen CREATE-Audit-Eintrag.
 *
 * `createDraftInvoiceWithinTx` laeuft in einer vom Aufrufer uebergebenen Transaktion
 * (Muster: finalizeWithinTx in ./finalize.ts) — genutzt vom Rechnungs-Duplikat
 * (src/domain/document/duplicate.ts), damit Erstellung, Relation und ChangeLog
 * atomar bleiben (Lastenheft 50).
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { computeLineNet } from "@/lib/pricing/line";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { normalizeLines } from "@/domain/document/lines";
import { loadDocumentSettings } from "@/domain/document/settings";
import { pickTextTemplate } from "@/domain/text-template/pick";
import type { CreateInvoiceInput } from "@/schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateOptions {
  actor?: string;
  now?: Date;
}

export async function createDraftInvoiceWithinTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: CreateInvoiceInput,
  opts: CreateOptions = {},
) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  // normalizeLines vergibt Positionsnummern und erzwingt defensiv, dass Nicht-ITEM-Zeilen
  // (HEADING/TEXT/SUBTOTAL) keine Betraege tragen (Lastenheft §8) — Zod erzwingt das bereits
  // am Boundary, dies ist die zweite Verteidigungslinie fuer Aufrufer ohne Zod-Lauf.
  const normalized = normalizeLines(input.lines);
  const lines = normalized.map((line) => ({
    position: line.position,
    lineType: line.lineType,
    productId: line.productId,
    description: line.description,
    descriptionLong: line.descriptionLong,
    articleNumber: line.articleNumber,
    quantityMilli: line.quantityMilli,
    unit: line.unit,
    unitNetPriceCents: line.unitNetPriceCents,
    taxRate: line.taxRate,
    taxCategory: line.taxCategory,
    discountPermille: line.discountPermille,
    discountCents: line.discountCents,
    // Nicht-ITEM-Zeilen tragen quantityMilli=0/unitNetPriceCents=0 -> lineNetCents ohnehin 0;
    // computeLineNet trotzdem nur fuer ITEM aufrufen (gleiche Regel wie bei der
    // Summenbildung unten, §8: Nicht-ITEM nie in Berechnung).
    lineNetCents: line.lineType === "ITEM" ? computeLineNet(line).lineNetCents : 0,
  }));

  // Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL) gehen nie in Summen/Steuerberechnung ein.
  const itemLines = lines.filter((l) => l.lineType === "ITEM");

  // Kunde muss zur Organisation gehören (kein Cross-Tenant-Bezug).
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, orgId },
    select: {
      id: true,
      defaultPaymentMethodId: true,
      defaultPaymentTermsDays: true,
      // Phase 8a (§28): Kundenvorgaben-Prioritaetskette (Eingabe > Kunde > Settings/
      // TextTemplate > Systemdefault) — siehe Kommentare unten je Feld.
      defaultCurrency: true,
      defaultDiscountPermille: true,
      orderReference: true,
      paymentTermsText: true,
    },
  });
  if (!customer) throw new Error("Kunde nicht gefunden.");

  const settings = await loadDocumentSettings(orgId);
  // Waehrung (§28): Eingabe > Customer.defaultCurrency > DocumentSettings.defaultCurrency
  // (selbstheilend geladen, Default darin bereits "EUR") > "EUR".
  const currency = input.currency ?? customer.defaultCurrency ?? settings.defaultCurrency ?? "EUR";

  // Fehlt die Zahlungsmethode, greift zuerst die Standard-Zahlungsmethode des Kunden
  // (Selbstheilung), danach die Org-weite Standard-Zahlungsmethode aus den Einstellungen
  // (Phase 7, `defaultPaymentMethodId`).
  const paymentMethodId = input.paymentMethodId ?? customer.defaultPaymentMethodId ?? settings.defaultPaymentMethodId ?? undefined;
  let method: { id: string; paymentTermsDays: number | null } | null = null;
  if (paymentMethodId) {
    method = await tx.paymentMethod.findFirst({ where: { id: paymentMethodId, orgId }, select: { id: true, paymentTermsDays: true } });
    if (!method) throw new Error("Zahlungsmethode nicht gefunden.");
  }

  const issueDate = input.issueDate ?? now;
  // Faelligkeit (Phase 7, §33; S1 Fix-Welle): explizite Eingabe schlaegt alles; sonst
  // Customer.defaultPaymentTermsDays (der Kunde ist die spezifischste Zusage — z.B. ein
  // vertraglich vereinbartes 30-Tage-Ziel), danach die Zahlungsfrist der Zahlungsmethode,
  // danach DocumentSettings.invoiceDueDays, danach 14 Tage. Faelligkeit liegt
  // konstruktionsbedingt nie vor dem Rechnungsdatum, da sie stets als issueDate + Tage
  // berechnet wird.
  const paymentTermsDays = customer.defaultPaymentTermsDays ?? method?.paymentTermsDays ?? settings.invoiceDueDays ?? 14;
  const dueDate = input.dueDate ?? new Date(issueDate.getTime() + paymentTermsDays * DAY_MS);

  // autoDeliveryDate (Phase 7, §33): fehlt jedes der drei Leistungsdatum-Felder, wird das
  // Rechnungsdatum als Leistungsdatum uebernommen, wenn die Einstellung aktiv ist.
  const hasDeliveryInfo = input.deliveryDate != null || input.deliveryStart != null || input.deliveryEnd != null;
  const deliveryDate = hasDeliveryInfo ? input.deliveryDate : settings.autoDeliveryDate ? issueDate : input.deliveryDate;

  // Kopffelder (Phase 4b) — org- UND kundengeprueft (Fix-Runde 1): Ansprechpartner/
  // Rechnungs-/Lieferadresse muessen zur Organisation UND zum ausgewaehlten Kunden
  // gehoeren, sonst koennte ein fremder Ansprechpartner/eine fremde Adresse (anderer
  // Kunde derselben Org) unbemerkt an die Rechnung gehaengt werden.
  //
  // Phase 8a (§29/§30): fehlt die Angabe komplett (`undefined`, nicht explizit `null`),
  // greift die Default-Adresse/der Default-Ansprechpartner des Kunden (Prioritaetskette
  // Eingabe > Default). Explizites `null` (Formular geleert) uebernimmt bewusst KEINEN
  // Default — der Nutzer hat die Auswahl aktiv entfernt.
  let contactPersonId = input.contactPersonId;
  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId, customerId: input.customerId }, select: { id: true } });
    if (!contact) throw new Error("Ansprechpartner nicht gefunden.");
  } else if (contactPersonId === undefined) {
    const defaultContact = await tx.contactPerson.findFirst({ where: { orgId, customerId: input.customerId, isDefault: true }, select: { id: true } });
    contactPersonId = defaultContact?.id ?? null;
  }
  let billingAddressId = input.billingAddressId;
  if (billingAddressId) {
    const address = await tx.customerAddress.findFirst({ where: { id: billingAddressId, orgId, customerId: input.customerId }, select: { id: true } });
    if (!address) throw new Error("Rechnungsadresse nicht gefunden.");
  } else if (billingAddressId === undefined) {
    const defaultAddress = await tx.customerAddress.findFirst({ where: { orgId, customerId: input.customerId, type: "BILLING", isDefault: true }, select: { id: true } });
    billingAddressId = defaultAddress?.id ?? null;
  }
  let shippingAddressId = input.shippingAddressId;
  if (shippingAddressId) {
    const address = await tx.customerAddress.findFirst({ where: { id: shippingAddressId, orgId, customerId: input.customerId }, select: { id: true } });
    if (!address) throw new Error("Lieferadresse nicht gefunden.");
  } else if (shippingAddressId === undefined) {
    const defaultAddress = await tx.customerAddress.findFirst({ where: { orgId, customerId: input.customerId, type: "SHIPPING", isDefault: true }, select: { id: true } });
    shippingAddressId = defaultAddress?.id ?? null;
  }

  // Rabatt (§28): Eingabe > Customer.defaultDiscountPermille — nur wenn BEIDE
  // Rabattfelder am Beleg fehlen (Task-2-Facts). Ein expliziter Wert (auch 0) gewinnt
  // immer gegen die Kundenvorgabe.
  const hasExplicitDiscount = input.documentDiscountPermille !== undefined || input.documentDiscountCents !== undefined;
  const documentDiscountPermille = hasExplicitDiscount ? (input.documentDiscountPermille ?? 0) : (customer.defaultDiscountPermille ?? 0);
  const documentDiscountCents = hasExplicitDiscount ? (input.documentDiscountCents ?? 0) : 0;

  // Bestellreferenz (§28): Eingabe > Customer.orderReference (BT-13).
  const orderNumber = input.orderNumber ?? customer.orderReference ?? undefined;

  // Texte (§28): Eingabe > Kunden-Text (nur Zahlungsbedingungen — Invoice kennt kein
  // eigenes Kopf-/Fusstext-Kundenfeld) > TextTemplate. createDraftInvoiceWithinTx wandte
  // bislang GAR KEINE Textvorlage an (anders als createBusinessDocumentWithinTx) — mit
  // Phase 8a nachgezogen.
  const headerText = input.headerText ?? (await pickTextTemplate(tx, orgId, "INVOICE", "HEAD")) ?? undefined;
  const footerText = input.footerText ?? (await pickTextTemplate(tx, orgId, "INVOICE", "FOOT")) ?? undefined;
  const paymentTerms = input.paymentTerms ?? customer.paymentTermsText ?? (await pickTextTemplate(tx, orgId, "INVOICE", "TERMS_PAYMENT")) ?? undefined;

  const totals = computeTaxBreakdown(
    itemLines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    {
      discountPermille: documentDiscountPermille,
      discountCents: documentDiscountCents,
      chargePermille: input.documentChargePermille,
      chargeCents: input.documentChargeCents,
    },
  );

  const invoice = await tx.invoice.create({
    data: {
      orgId,
      customerId: input.customerId,
      type: input.type,
      taxScheme: input.taxScheme,
      currency,
      issueDate,
      deliveryDate,
      deliveryStart: input.deliveryStart,
      deliveryEnd: input.deliveryEnd,
      dueDate,
      buyerReference: input.buyerReference,
      subject: input.subject,
      orderNumber,
      internalReference: input.internalReference,
      contactPersonId,
      billingAddressId,
      shippingAddressId,
      notes: input.notes,
      paymentTerms,
      internalNotes: input.internalNotes,
      headerText,
      footerText,
      documentDiscountPermille,
      documentDiscountCents,
      documentChargePermille: input.documentChargePermille,
      documentChargeCents: input.documentChargeCents,
      documentChargeReason: input.documentChargeReason,
      skonto1Permille: input.skonto1Permille,
      skonto1Days: input.skonto1Days,
      skonto2Permille: input.skonto2Permille,
      skonto2Days: input.skonto2Days,
      paymentMethodId,
      netTotalCents: totals.netTotalCents,
      taxTotalCents: totals.taxTotalCents,
      grossTotalCents: totals.grossTotalCents,
      taxBreakdownJson: JSON.stringify(totals.breakdown),
      lines: { create: lines },
    },
    include: { lines: { orderBy: { position: "asc" } } },
  });

  await appendChangeLog(tx, {
    orgId,
    entity: "INVOICE",
    entityId: invoice.id,
    action: "CREATE",
    actor,
    at: now,
    diff: { type: input.type, taxScheme: input.taxScheme, grossTotalCents: totals.grossTotalCents },
  });
  await logActivity(tx, { orgId, entityType: "INVOICE", entityId: invoice.id, type: "CREATED", actor, at: now });

  return invoice;
}

export async function createDraftInvoice(
  orgId: string,
  input: CreateInvoiceInput,
  opts: CreateOptions = {},
) {
  return dbInternal.$transaction((tx) => createDraftInvoiceWithinTx(tx, orgId, input, opts));
}
