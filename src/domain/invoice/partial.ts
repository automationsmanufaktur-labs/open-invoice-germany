/**
 * Teilrechnung (§ 13 UStG): eine Rechnung ueber einen Teil einer Gesamtleistung, deren
 * Quelle ein Angebot/eine Auftragsbestaetigung (Quote, kind ANGEBOT/AUFTRAGSBESTAETIGUNG)
 * oder ein Lieferschein sein kann. Zwei grundsaetzlich verschiedene Eingabeformen:
 *
 *   - PERCENT/NET_AMOUNT/GROSS_AMOUNT: der Anteil wird je Steuersatz-Bucket der Quelle
 *     berechnet (`splitByTaxRate`, src/lib/pricing/partial.ts) und als EINE ITEM-Zeile
 *     je Bucket ausgewiesen ("Teilleistung ... zu <Quelle Nr.>").
 *   - POSITIONS/QUANTITIES: einzelne Positionen (voll) bzw. Teilmengen einzelner
 *     Positionen werden 1:1 aus der Quelle kopiert; die bereits abgerechnete Menge wird
 *     gegen `billedQuantities` geprueft (keine Doppelabrechnung).
 *
 * Laeuft komplett in einer Transaktion: Quelle laden+pruefen, Rechnung anlegen
 * (ueber `createDraftInvoiceWithinTx`, das bereits Kunde/Zahlungsmethode/ChangeLog
 * uebernimmt), Kopf-Felder (sourceType/sourceId/partialPermille/sourceLineId je Zeile)
 * nachtragen, Relation PARTIAL_OF setzen, Quelle ggf. auf ACCEPTED heben.
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { formatCents, roundHalfUp } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { computeLineNet } from "@/lib/pricing/line";
import { splitByTaxRate, formatPermilleDE, type TaxRateSplit } from "@/lib/pricing/partial";
import { PricingError } from "@/lib/pricing/errors";
import type { RateBucket } from "@/lib/pricing/allocate";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments, listRelations } from "@/domain/relations";
import { createDraftInvoiceWithinTx } from "@/domain/invoice/create";
import { setQuoteStatusWithinTx } from "@/domain/document/status";
import { billedQuantities, type PartialSourceType } from "@/domain/invoice/billed-quantities";
import { NotFoundError } from "@/domain/errors";
import { createPartialInvoiceSchema, type CreatePartialInvoiceInput } from "@/schemas";
import type { CreateInvoiceInput } from "@/schemas";

export class PartialInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartialInvoiceError";
  }
}

const QUOTE_KINDS_ALLOWED = new Set(["ANGEBOT", "AUFTRAGSBESTAETIGUNG"]);
const QUOTE_STATUS_ALLOWED = new Set(["DRAFT", "SENT", "ACCEPTED"]);
const DELIVERY_NOTE_STATUS_ALLOWED = new Set(["CREATED", "SENT", "DELIVERED"]);

interface PartialSourceLine {
  id: string;
  description: string;
  unit: string;
  quantityMilli: number;
  // B12 (Fix-Welle): DeliveryNoteLine.unitNetPriceCents/taxRate sind nullable
  // (preisloser Lieferschein ist der Normalfall, `showPrices` defaultet auf false) —
  // die Preis-/Steuerpruefung darf deshalb nicht beim Laden ALLER Quellzeilen
  // pauschal fehlschlagen, sondern erst dort, wo eine konkrete Zeile tatsaechlich
  // abgerechnet wird (`positionLinesForMode`/`assertAllLinesPriced`).
  unitNetPriceCents: number | null;
  taxRate: number | null;
  taxCategory: string;
  lineNetCents: number;
  // Fix-Welle (B1): Positionsrabatt der Quellzeile — ohne diese Felder wuerden
  // POSITIONS/QUANTITIES-Teilrechnungen einen Zeilenrabatt der Quelle stillschweigend
  // fallen lassen und den Kunden ueberhoeht abrechnen (Ruling Koordinator).
  discountPermille: number;
  discountCents: number;
}

interface PartialSource {
  customerId: string;
  number: string;
  status: string;
  taxScheme: string;
  currency: string;
  headerText: string | null;
  footerText: string | null;
  paymentTerms: string | null;
  // Fix-Runde 1 (Koordinator): Kopf-Felder der Quelle fuer Snapshot-Konsistenz
  // Angebot/Lieferschein -> Teilrechnung — billingAddressId nur bei QUOTE, shippingAddressId
  // nur bei DELIVERY_NOTE gesetzt (siehe loadPartialSource, "wenn vorhanden").
  contactPersonId: string | null;
  billingAddressId: string | null;
  shippingAddressId: string | null;
  sellerSnapshotJson: string | null;
  buyerSnapshotJson: string | null;
  contactSnapshotJson: string | null;
  // Fix-Runde 2: Anteilsbasis fuer PERCENT/NET_AMOUNT/GROSS_AMOUNT ist die
  // Gesamtleistung NACH Beleg-Rabatt/-Aufschlag der Quelle (Ruling Koordinator) —
  // ohne diese Felder wuerde eine 100 %-Teilrechnung mehr als grossTotalCents
  // ausweisen, sobald die Quelle einen Beleg-Rabatt/-Aufschlag traegt.
  documentDiscountPermille: number;
  documentDiscountCents: number;
  documentChargePermille: number;
  documentChargeCents: number;
  lines: PartialSourceLine[];
}

/** Laedt und validiert die Quelle (mandantengeprueft) — Quote oder DeliveryNote. */
async function loadPartialSource(
  tx: Prisma.TransactionClient,
  orgId: string,
  sourceType: PartialSourceType,
  sourceId: string,
): Promise<PartialSource> {
  if (sourceType === "QUOTE") {
    const q = await tx.quote.findFirst({ where: { id: sourceId, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!q) throw new NotFoundError(`Angebot/Auftragsbestaetigung ${sourceId} nicht gefunden.`);
    if (!QUOTE_KINDS_ALLOWED.has(q.kind)) {
      throw new PartialInvoiceError(`Nur ein Angebot/eine Auftragsbestaetigung kann Quelle einer Teilrechnung sein (kind: ${q.kind}).`);
    }
    if (!QUOTE_STATUS_ALLOWED.has(q.status)) {
      throw new PartialInvoiceError(`Angebot/Auftragsbestaetigung im Status "${q.status}" kann nicht teilweise abgerechnet werden.`);
    }
    // Keine Vermischung Teil-/Abschlagsrechnung auf derselben Quelle (Ruling Task-2-Facts).
    // B13 (Fix-Welle): tx statt dbInternal — das Mischverbot-Pruefung liest damit
    // innerhalb derselben Transaktion, in der auch geschrieben wird.
    const relations = await listRelations(orgId, "QUOTE", sourceId, tx);
    const hasDownpayment = relations.some((r) => r.fromType === "INVOICE" && r.toType === "QUOTE" && r.toId === sourceId && r.relationType === "DOWNPAYMENT_OF");
    if (hasDownpayment) {
      throw new PartialInvoiceError("Auf dieser Quelle bestehen bereits Abschlagsrechnungen — Teil- und Abschlagsrechnungen koennen nicht gemischt werden.");
    }
    return {
      customerId: q.customerId,
      number: q.number ?? "",
      status: q.status,
      taxScheme: q.taxScheme,
      currency: q.currency,
      headerText: q.headerText,
      footerText: q.footerText,
      paymentTerms: q.paymentTerms,
      contactPersonId: q.contactPersonId,
      billingAddressId: q.billingAddressId,
      shippingAddressId: null, // Quote kennt keine eigene Lieferadresse
      sellerSnapshotJson: q.sellerSnapshotJson,
      buyerSnapshotJson: q.buyerSnapshotJson,
      contactSnapshotJson: q.contactSnapshotJson,
      documentDiscountPermille: q.documentDiscountPermille,
      documentDiscountCents: q.documentDiscountCents,
      documentChargePermille: q.documentChargePermille,
      documentChargeCents: q.documentChargeCents,
      lines: q.lines
        .filter((l) => l.lineType === "ITEM")
        .map((l) => ({
          id: l.id,
          description: l.description,
          unit: l.unit,
          quantityMilli: l.quantityMilli,
          unitNetPriceCents: l.unitNetPriceCents,
          taxRate: l.taxRate,
          taxCategory: l.taxCategory,
          lineNetCents: l.lineNetCents,
          discountPermille: l.discountPermille,
          discountCents: l.discountCents,
        })),
    };
  }

  const n = await tx.deliveryNote.findFirst({ where: { id: sourceId, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!n) throw new NotFoundError(`Lieferschein ${sourceId} nicht gefunden.`);
  if (!DELIVERY_NOTE_STATUS_ALLOWED.has(n.status)) {
    throw new PartialInvoiceError(`Lieferschein im Status "${n.status}" kann nicht abgerechnet werden.`);
  }
  // B12 (Fix-Welle): kein eager throw mehr fuer preislose Zeilen — ein Lieferschein ohne
  // Preise (`showPrices: false`, der Normalfall) darf weiterhin per POSITIONS/QUANTITIES
  // abgerechnet werden, solange die tatsaechlich ausgewaehlten Zeilen einen Preis tragen
  // (Pruefung in `positionLinesForMode`/`assertAllLinesPriced`, nicht hier).
  const lines = n.lines.map((l) => ({
    id: l.id,
    description: l.description,
    unit: l.unit,
    quantityMilli: l.quantityMilli,
    unitNetPriceCents: l.unitNetPriceCents,
    taxRate: l.taxRate,
    // DeliveryNoteLine kennt keine taxCategory (Abgrenzung Task 1-Schema) — Standard "S".
    taxCategory: "S",
    lineNetCents: l.unitNetPriceCents != null ? Math.round((l.quantityMilli * l.unitNetPriceCents) / 1000) : 0,
    // DeliveryNoteLine kennt keinen Positionsrabatt (Abgrenzung Task 1-Schema).
    discountPermille: 0,
    discountCents: 0,
  }));
  return {
    customerId: n.customerId,
    number: n.number ?? "",
    status: n.status,
    // DeliveryNote kennt weder taxScheme noch currency (Abgrenzung Task 1-Schema) —
    // Standardwerte wie bei sonstigen Selbstheilungspfaden (createDraftInvoiceWithinTx).
    taxScheme: "REGULAR",
    currency: "EUR",
    headerText: n.headerText,
    footerText: n.footerText,
    paymentTerms: null,
    contactPersonId: n.contactPersonId,
    billingAddressId: null, // DeliveryNote kennt keine eigene Rechnungsadresse
    shippingAddressId: n.shippingAddressId,
    sellerSnapshotJson: n.sellerSnapshotJson,
    buyerSnapshotJson: n.buyerSnapshotJson,
    contactSnapshotJson: n.contactSnapshotJson,
    // DeliveryNote kennt keinen Beleg-Rabatt/-Aufschlag (Abgrenzung Task 1-Schema).
    documentDiscountPermille: 0,
    documentDiscountCents: 0,
    documentChargePermille: 0,
    documentChargeCents: 0,
    lines,
  };
}

interface BuiltLine {
  description: string;
  unit: string;
  quantityMilli: number;
  unitNetPriceCents: number;
  taxRate: number;
  taxCategory: string;
  sourceLineId?: string;
  // Fix-Welle (B1): Positionsrabatt, der auf die gebaute Zeile uebertragen wird
  // (0 bei den Anteils-Modi PERCENT/NET_AMOUNT/GROSS_AMOUNT, dort steckt der einzige
  // Rabatt/Aufschlag bereits in den Bucket-Nettobetraegen).
  discountPermille: number;
  discountCents: number;
}

interface BuiltResult {
  lines: BuiltLine[];
  partialPermille: number | null;
  documentDiscountPermille: number;
  documentDiscountCents: number;
  documentChargePermille: number;
  documentChargeCents: number;
}

/**
 * Gesamtleistung der Quelle NACH Beleg-Rabatt/-Aufschlag (Fix-Runde 2) — Grundlage
 * sowohl der PERCENT/NET_AMOUNT/GROSS_AMOUNT-Bucket-Aufteilung als auch des
 * kumulativen Ueberbuchungs-Guards (B3, Fix-Welle) fuer ALLE Modi (auch POSITIONS/
 * QUANTITIES). `computeTaxBreakdown` liefert je Steuersatz den bereits angepassten
 * Nettobetrag; Σ(net+tax) == source.grossTotalCents (QUOTE) exakt.
 */
function sourceAdjustedTotals(source: PartialSource) {
  // B12: preislose Zeilen (Lieferschein, taxRate=null) tragen bereits lineNetCents=0
  // (loadPartialSource) und gehen mit taxRate 0 in eine eigene, wirkungslose Gruppe ein
  // — diese Funktion dient nur als Bezugsgroesse fuer den Ueberbuchungs-Guard/die
  // Bucket-Aufteilung, nicht als Preis-Validierung (die laeuft lazy, siehe
  // assertLinePriced/assertAllLinesPriced).
  const totals = computeTaxBreakdown(
    source.lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate ?? 0, taxCategory: l.taxCategory })),
    {
      discountPermille: source.documentDiscountPermille,
      discountCents: source.documentDiscountCents,
      chargePermille: source.documentChargePermille,
      chargeCents: source.documentChargeCents,
    },
  );
  if (totals.breakdown.length === 0) {
    throw new PartialInvoiceError("Die Quelle enthaelt keine abrechenbaren Positionen.");
  }
  return totals;
}

/**
 * B12/B11 (Fix-Welle): PERCENT/NET_AMOUNT/GROSS_AMOUNT rechnen den Anteil ueber die
 * GESAMTE Quelle (Steuersatz-Buckets aus allen Zeilen) — anders als POSITIONS/
 * QUANTITIES, wo nur die tatsaechlich gewaehlten Zeilen einen Preis brauchen, kann ein
 * Anteils-Modus ohne Preis auf JEDER Zeile keine sinnvolle Gesamtleistung bilden. Wird
 * nur fuer die Anteils-Modi aufgerufen (POSITIONS/QUANTITIES pruefen lazy je Zeile,
 * siehe `assertLinePriced`).
 */
function assertAllLinesPriced(source: PartialSource): void {
  const unpriced = source.lines.find((l) => l.unitNetPriceCents == null || l.taxRate == null);
  if (unpriced) {
    throw new PartialInvoiceError(
      `Position "${unpriced.description}" hat keinen Preis/Steuersatz — ein prozentualer/fester Anteil kann nur berechnet werden, wenn alle Positionen der Quelle einen Preis tragen. Nutze POSITIONS/QUANTITIES fuer preislose Quellen.`,
    );
  }
}

function splitLinesForShareMode(
  input: CreatePartialInvoiceInput,
  source: PartialSource,
  adjustedTotals: ReturnType<typeof sourceAdjustedTotals>,
): BuiltResult {
  assertAllLinesPriced(source);
  const buckets: RateBucket[] = adjustedTotals.breakdown.map((b) => ({
    key: `${b.taxCategory}:${b.taxRate}`,
    taxCategory: b.taxCategory,
    taxRate: b.taxRate,
    netCents: b.netCents,
  }));

  const share = input.mode === "PERCENT" ? { permille: input.permille! } : { amountCents: input.amountCents!, isGross: input.mode === "GROSS_AMOUNT" };
  let splits: TaxRateSplit[];
  try {
    splits = splitByTaxRate(buckets, share);
  } catch (e) {
    if (e instanceof PricingError) throw new PartialInvoiceError(e.message);
    throw e;
  }

  const label =
    input.mode === "PERCENT"
      ? `Teilleistung ${formatPermilleDE(input.permille!)} % zu ${source.number}`
      : `Teilleistung ${formatCents(input.amountCents!)} ${input.mode === "GROSS_AMOUNT" ? "brutto" : "netto"} zu ${source.number}`;

  const lines: BuiltLine[] = splits
    .filter((s) => s.netCents > 0 || s.taxCents > 0)
    .map((s) => ({
      description: label,
      unit: "C62",
      quantityMilli: 1000,
      unitNetPriceCents: s.netCents,
      taxRate: s.taxRate,
      taxCategory: s.taxCategory,
      sourceLineId: undefined,
      discountPermille: 0,
      discountCents: 0,
    }));

  if (lines.length === 0) {
    throw new PartialInvoiceError("Der berechnete Anteil ergibt keine abrechenbare Position (Betrag 0).");
  }

  // B1: der Beleg-Rabatt/-Aufschlag der Quelle steckt bereits in den Bucket-Netto-
  // betraegen (adjustedTotals kommt aus computeTaxBreakdown MIT den Beleg-Feldern) —
  // die Teilrechnung selbst traegt deshalb keinen eigenen Beleg-Rabatt/-Aufschlag,
  // sonst wuerde er doppelt wirken.
  return {
    lines,
    partialPermille: input.mode === "PERCENT" ? input.permille! : null,
    documentDiscountPermille: 0,
    documentDiscountCents: 0,
    documentChargePermille: 0,
    documentChargeCents: 0,
  };
}

/**
 * B1 (Fix-Welle, Ruling Koordinator): Beleg-Rabatt/-Aufschlag der Quelle anteilig auf
 * eine POSITIONS/QUANTITIES-Teilrechnung uebertragen — sonst wuerde eine Teilrechnung
 * ueber einzelne Positionen den Beleg-Rabatt der Quelle stillschweigend verlieren und
 * den Kunden ueberhoeht abrechnen. Permille-Anteile werden 1:1 uebernommen (sie
 * skalieren automatisch mit der kleineren abgerechneten Netto-Basis); feste Cent-
 * Anteile werden proportional zum Anteil des abgerechneten Zeilen-Nettos (NACH
 * Zeilenrabatt, VOR Beleganpassung) am gesamten Quell-Netto aufgeteilt (roundHalfUp).
 */
function documentAdjustmentForBilledLines(
  source: PartialSource,
  builtLines: readonly BuiltLine[],
): Pick<BuiltResult, "documentDiscountPermille" | "documentDiscountCents" | "documentChargePermille" | "documentChargeCents"> {
  const totalSourceNetCents = source.lines.reduce((s, l) => s + l.lineNetCents, 0);
  if (totalSourceNetCents <= 0) {
    return { documentDiscountPermille: 0, documentDiscountCents: 0, documentChargePermille: 0, documentChargeCents: 0 };
  }
  const billedNetCents = builtLines.reduce(
    (s, l) =>
      s +
      computeLineNet({
        quantityMilli: l.quantityMilli,
        unitNetPriceCents: l.unitNetPriceCents,
        discountPermille: l.discountPermille,
        discountCents: l.discountCents,
      }).lineNetCents,
    0,
  );
  return {
    documentDiscountPermille: source.documentDiscountPermille,
    documentDiscountCents: roundHalfUp((source.documentDiscountCents * billedNetCents) / totalSourceNetCents),
    documentChargePermille: source.documentChargePermille,
    documentChargeCents: roundHalfUp((source.documentChargeCents * billedNetCents) / totalSourceNetCents),
  };
}

/**
 * B12 (Fix-Welle, Ruling Koordinator): Preis-/Steuersatz-Pruefung NUR fuer die
 * tatsaechlich ausgewaehlte Zeile — vorher schlug `loadPartialSource` bereits beim
 * Laden fuer JEDE preislose Lieferschein-Zeile fehl, obwohl `showPrices: false` der
 * Normalfall ist (Lieferscheine sind meist ohne Preise) und die konkret gewaehlten
 * Zeilen durchaus einen Preis tragen koennen.
 */
function assertLinePriced(src: PartialSourceLine): asserts src is PartialSourceLine & { unitNetPriceCents: number; taxRate: number } {
  if (src.unitNetPriceCents == null || src.taxRate == null) {
    throw new PartialInvoiceError(`Position "${src.description}" hat keinen Preis/Steuersatz und kann nicht abgerechnet werden.`);
  }
}

function positionLinesForMode(input: CreatePartialInvoiceInput, source: PartialSource, billed: Map<string, number>): BuiltResult {
  const byId = new Map(source.lines.map((l) => [l.id, l]));
  const lines: BuiltLine[] = [];

  if (input.mode === "POSITIONS") {
    for (const lineId of input.lineIds!) {
      const src = byId.get(lineId);
      if (!src) throw new PartialInvoiceError(`Quellposition ${lineId} unbekannt.`);
      assertLinePriced(src);
      const billedMilli = billed.get(lineId) ?? 0;
      if (billedMilli > 0) {
        throw new PartialInvoiceError(`Position "${src.description}" wurde bereits (teilweise) abgerechnet und kann nicht erneut als volle Position gewaehlt werden.`);
      }
      lines.push({
        description: src.description,
        unit: src.unit,
        quantityMilli: src.quantityMilli,
        unitNetPriceCents: src.unitNetPriceCents,
        taxRate: src.taxRate,
        taxCategory: src.taxCategory,
        sourceLineId: lineId,
        // B1: volle Position -> Zeilenrabatt unveraendert uebernommen.
        discountPermille: src.discountPermille,
        discountCents: src.discountCents,
      });
    }
  } else {
    for (const q of input.quantities!) {
      const src = byId.get(q.sourceLineId);
      if (!src) throw new PartialInvoiceError(`Quellposition ${q.sourceLineId} unbekannt.`);
      assertLinePriced(src);
      const billedMilli = billed.get(q.sourceLineId) ?? 0;
      const remainingMilli = src.quantityMilli - billedMilli;
      if (q.quantityMilli > remainingMilli) {
        throw new PartialInvoiceError(
          `Menge ${q.quantityMilli} ueberschreitet die Restmenge ${remainingMilli} fuer Position "${src.description}".`,
        );
      }
      lines.push({
        description: src.description,
        unit: src.unit,
        quantityMilli: q.quantityMilli,
        unitNetPriceCents: src.unitNetPriceCents,
        taxRate: src.taxRate,
        taxCategory: src.taxCategory,
        sourceLineId: q.sourceLineId,
        // B1: Teilmenge -> Prozentrabatt 1:1 (skaliert automatisch mit der kleineren
        // Menge ueber computeLineNet), Festbetragsrabatt proportional zur abgerechneten
        // Menge (discountCents gilt fuer die GESAMTE Quellzeile, nicht je Einheit).
        discountPermille: src.discountPermille,
        discountCents: roundHalfUp((src.discountCents * q.quantityMilli) / src.quantityMilli),
      });
    }
  }

  if (lines.length === 0) throw new PartialInvoiceError("Mindestens eine Position ist erforderlich.");
  return { lines, partialPermille: null, ...documentAdjustmentForBilledLines(source, lines) };
}

/**
 * Bruttosumme aller aktiven (nicht stornierten) Teilrechnungen dieser Quelle — Grundlage
 * des kumulativen Ueberbuchungs-Guards (Fix-Runde 1, HIGH). DRAFT zaehlt bereits mit
 * (analog `billedQuantities`/`billingStateFor`s `billedPermille`).
 */
async function activePartialGrossCents(
  tx: Prisma.TransactionClient,
  orgId: string,
  sourceType: PartialSourceType,
  sourceId: string,
): Promise<number> {
  const active = await tx.invoice.findMany({
    where: { orgId, sourceType, sourceId, type: "PARTIAL", status: { not: "CANCELLED" } },
    select: { grossTotalCents: true },
  });
  return active.reduce((s, i) => s + i.grossTotalCents, 0);
}

export interface CreatePartialInvoiceOptions {
  actor?: string;
  now?: Date;
}

export async function createPartialInvoice(orgId: string, rawInput: unknown, opts: CreatePartialInvoiceOptions = {}) {
  const input = createPartialInvoiceSchema.parse(rawInput);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const source = await loadPartialSource(tx, orgId, input.sourceType, input.sourceId);
    const adjustedTotals = sourceAdjustedTotals(source);

    const isShareMode = input.mode === "PERCENT" || input.mode === "NET_AMOUNT" || input.mode === "GROSS_AMOUNT";
    const built = isShareMode
      ? splitLinesForShareMode(input, source, adjustedTotals)
      : positionLinesForMode(input, source, await billedQuantities(orgId, input.sourceType, input.sourceId, tx));

    const createInput: CreateInvoiceInput = {
      customerId: source.customerId,
      type: "PARTIAL",
      taxScheme: source.taxScheme as CreateInvoiceInput["taxScheme"],
      currency: source.currency,
      // Leistungszeitpunkt (§14 Abs.4 Nr.6): Quote/DeliveryNote fuehren kein eigenes
      // Lieferdatum-Feld je Teilrechnungs-Anteil — Ersatzweise das Anlagedatum, analog
      // convertDocumentToInvoice (issueDate: now ohne eigenes deliveryDate).
      deliveryDate: now,
      headerText: source.headerText ?? undefined,
      footerText: source.footerText ?? undefined,
      paymentTerms: source.paymentTerms ?? undefined,
      // Fix-Runde 1 (Koordinator): Ansprechpartner/Rechnungs-/Lieferadresse der Quelle
      // uebernehmen statt der Kunden-Defaults — Snapshot-Konsistenz Angebot/Lieferschein ->
      // Teilrechnung (nur das je Quelltyp vorhandene Feld ist gesetzt, siehe PartialSource).
      // Direkte Uebernahme (kein `?? undefined`): `null` an der Quelle bedeutet "kein
      // Ansprechpartner/keine Adresse gewaehlt" und soll NICHT den Default-Lookup in
      // createDraftInvoiceWithinTx ausloesen (der greift nur bei `undefined`).
      contactPersonId: source.contactPersonId,
      billingAddressId: source.billingAddressId,
      shippingAddressId: source.shippingAddressId,
      // B1 (Fix-Welle): bei POSITIONS/QUANTITIES anteiliger Beleg-Rabatt/-Aufschlag der
      // Quelle (documentAdjustmentForBilledLines); bei den Anteils-Modi 0 (bereits in
      // den Bucket-Nettobetraegen eingepreist, siehe splitLinesForShareMode).
      documentDiscountPermille: built.documentDiscountPermille,
      documentDiscountCents: built.documentDiscountCents,
      documentChargePermille: built.documentChargePermille,
      documentChargeCents: built.documentChargeCents,
      lines: built.lines.map((l) => ({
        lineType: "ITEM",
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        taxRate: l.taxRate as CreateInvoiceInput["lines"][number]["taxRate"],
        taxCategory: l.taxCategory as CreateInvoiceInput["lines"][number]["taxCategory"],
        discountPermille: l.discountPermille,
        discountCents: l.discountCents,
      })),
    };

    const invoice = await createDraftInvoiceWithinTx(tx, orgId, createInput, { actor, now });

    // B3 (Fix-Welle): kumulativer Ueberbuchungs-Guard fuer ALLE Modi (vorher nur
    // PERCENT/NET_AMOUNT/GROSS_AMOUNT) — ohne ihn liess sich dieselbe Quelle per
    // POSITIONS/QUANTITIES nach einer bereits ausgeschoepften PERCENT-Teilrechnung
    // (sourceLineId = null, von `billedQuantities` nicht erfasst) beliebig oft ueber
    // 100 % hinaus abrechnen. Vergleich auf dem tatsaechlich persistierten
    // `invoice.grossTotalCents` (nicht einer separat vorgerechneten Schaetzung) —
    // ein Verstoss wirft und rollt die ganze Transaktion zurueck (Invoice nie sichtbar).
    const existingActiveGrossCents = await activePartialGrossCents(tx, orgId, input.sourceType, input.sourceId);
    const sourceGrossCents = adjustedTotals.grossTotalCents;
    if (existingActiveGrossCents + invoice.grossTotalCents > sourceGrossCents) {
      throw new PartialInvoiceError(
        `Die Summe der Teilrechnungen (${existingActiveGrossCents + invoice.grossTotalCents} Cent) wuerde die Gesamtleistung (${sourceGrossCents} Cent) uebersteigen.`,
      );
    }

    // Fix-Runde 1 (Koordinator): Seller-/Buyer-/Kontakt-Snapshot der Quelle uebernehmen
    // statt live aus dem (moeglicherweise seither geaenderten) Kundenstamm neu zu bauen —
    // Snapshot-Konsistenz Angebot/Lieferschein -> Teilrechnung.
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        partialPermille: built.partialPermille,
        sellerSnapshotJson: source.sellerSnapshotJson,
        buyerSnapshotJson: source.buyerSnapshotJson,
        contactSnapshotJson: source.contactSnapshotJson,
        snapshotSource: "INHERITED",
        snapshotAt: now,
      },
    });

    if (built.lines.some((l) => l.sourceLineId)) {
      for (let i = 0; i < invoice.lines.length; i++) {
        const sourceLineId = built.lines[i]?.sourceLineId;
        if (sourceLineId) {
          await tx.invoiceLine.update({ where: { id: invoice.lines[i].id }, data: { sourceLineId } });
        }
      }
    }

    await linkDocuments(tx, {
      orgId,
      fromType: "INVOICE",
      fromId: invoice.id,
      toType: input.sourceType,
      toId: input.sourceId,
      relationType: "PARTIAL_OF",
    });

    if (input.sourceType === "QUOTE" && (source.status === "DRAFT" || source.status === "SENT")) {
      await setQuoteStatusWithinTx(tx, orgId, input.sourceId, "ACCEPTED", { actor, now });
    }

    await appendChangeLog(tx, {
      orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "PARTIAL_INVOICE_CREATE",
      actor,
      at: now,
      diff: { sourceType: input.sourceType, sourceId: input.sourceId, mode: input.mode },
    });

    return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: { orderBy: { position: "asc" } } } });
  });
}
