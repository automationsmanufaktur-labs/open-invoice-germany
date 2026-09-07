/**
 * Zod-Schemas — Validierung an jedem Boundary (API-Routes, Formulare).
 * Ersetzen zugleich die fehlenden Prisma-Enums (DB hält Strings).
 */
import { z } from "zod";
import { isValidIban, normalizeIban } from "@/lib/iban";
// Fix-Runde 1, Befund 3: eine Quelle fuer das Groessenlimit je Anhang statt einer
// zweiten Konstante hier (galt zuvor doppelt gepflegt fuer src/lib/attachments/mime.ts).
import { MAX_ATTACHMENT_FILE_BYTES } from "@/lib/attachments/mime";

// ── Enumerationen ────────────────────────────────────────────────────────
export const TaxScheme = z.enum([
  "REGULAR",
  "KLEINUNTERNEHMER",
  "DIFFERENZ",
  "REVERSE_CHARGE",
  "IG_LIEFERUNG",
  "IG_LEISTUNG",
  "DRITTLAND_LEISTUNG",
]);
export type TaxScheme = z.infer<typeof TaxScheme>;

export const TaxCategory = z.enum(["S", "AE", "K", "G", "E", "Z", "O"]);
export type TaxCategory = z.infer<typeof TaxCategory>;

export const TaxRate = z.union([z.literal(19), z.literal(7), z.literal(0)]);

// Positionstyp (Phase 4b) — HEADING/TEXT/SUBTOTAL tragen nie Betraege, gehen nie in
// Summen, XML oder Steuerberechnung (Lastenheft §8: kein Menge-0-Workaround).
export const LineType = z.enum(["ITEM", "HEADING", "TEXT", "SUBTOTAL"]);
export type LineType = z.infer<typeof LineType>;

export const CustomerType = z.enum(["BUSINESS", "CONSUMER"]);
// PARTIAL/DOWNPAYMENT/FINAL (Phase 5, §13-15 UStG): Teil-, Abschlags- und
// Schlussrechnung — jeweils eigenstaendige, festschreibbare Rechnungen (GoBD-Kette wie
// INVOICE/CREDIT_NOTE/CORRECTION), nur mit zusaetzlicher Quellreferenz (sourceType/
// sourceId, siehe unten) und ggf. Abzugsbloecke (FinalInvoiceDeduction).
export const InvoiceType = z.enum(["INVOICE", "CREDIT_NOTE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);
export const DocType = z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA", "INVOICE", "CREDIT_NOTE", "DUNNING", "DELIVERY_NOTE", "CUSTOMER", "PRODUCT"]);
// Codes kommen aus der Tabelle PaymentMethod (Stammdaten je Organisation); die
// Pruefung auf Existenz/Zugehoerigkeit erfolgt in recordPayment, nicht hier.
export const PaymentMethod = z.string().min(1).max(40);

// ── Beleg-Snapshots (Phase 0) ────────────────────────────────────────────────
// Feldgenau identisch mit MapInput.org / MapInput.customer in src/lib/einvoice/mapper.ts.
// Ein Unit-Test prueft die Schluesselmengen gegeneinander.
export const SnapshotSource = z.enum(["FINALIZE", "CREATE", "MIGRATION", "INHERITED", "SENT"]);
export type SnapshotSource = z.infer<typeof SnapshotSource>;

export const sellerSnapshotSchema = z.object({
  legalName: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  postalCode: z.string(),
  city: z.string(),
  country: z.string(),
  vatId: z.string().nullable(),
  taxNumber: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  electronicAddress: z.string().nullable(),
  iban: z.string().nullable(),
  bic: z.string().nullable(),
  bankName: z.string().nullable(),
});
export type SellerSnapshot = z.infer<typeof sellerSnapshotSchema>;

export const buyerSnapshotSchema = z.object({
  name: z.string(),
  contactName: z.string().nullable(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  postalCode: z.string(),
  city: z.string(),
  countryCode: z.string(),
  vatId: z.string().nullable(),
  email: z.string().nullable(),
  leitwegId: z.string().nullable(),
});
export type BuyerSnapshot = z.infer<typeof buyerSnapshotSchema>;

// Feldgenau identisch mit dem JSON aus src/domain/invoice/finalize.ts (paymentMethodSnapshotJson).
export const paymentMethodSnapshotSchema = z.object({
  code: z.string(),
  name: z.string(),
  invoiceText: z.string().nullable(),
  untdidCode: z.string(),
  bankIban: z.string().nullable(),
  bankBic: z.string().nullable(),
  bankName: z.string().nullable(),
});
export type PaymentMethodSnapshot = z.infer<typeof paymentMethodSnapshotSchema>;

// taxBreakdownJson (Invoice.taxBreakdownJson) — Alt-Belege ohne Beleganpassung (Phase 4a)
// kennen baseNetCents/allowanceCents/chargeCents noch nicht: Default 0 bzw. netCents.
export const taxBreakdownEntrySchema = z
  .object({
    taxCategory: z.string(),
    taxRate: z.number(),
    netCents: z.number(),
    taxCents: z.number(),
    baseNetCents: z.number().optional(),
    allowanceCents: z.number().default(0),
    chargeCents: z.number().default(0),
  })
  .transform((e) => ({ ...e, baseNetCents: e.baseNetCents ?? e.netCents }));
export const taxBreakdownSchema = z.array(taxBreakdownEntrySchema);
export type TaxBreakdownEntrySnapshot = z.infer<typeof taxBreakdownEntrySchema>;

// ── Stammdaten ───────────────────────────────────────────────────────────
export const organizationSchema = z.object({
  legalName: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().length(2).default("DE"),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  taxNumber: z.string().optional(),
  vatId: z.string().optional(),
  kuIdNr: z.string().optional(),
  smallBusiness: z.boolean().default(false),
  defaultTaxScheme: TaxScheme.default("REGULAR"),
  iban: z
    .string()
    .optional()
    .transform((s) => (s ? normalizeIban(s) : s))
    .refine((s) => !s || isValidIban(s), "Ungültige IBAN"),
  bic: z.string().optional(),
  bankName: z.string().optional(),
  electronicAddress: z.string().optional(),
});
export type OrganizationInput = z.infer<typeof organizationSchema>;

export const customerSchema = z.object({
  type: CustomerType.default("BUSINESS"),
  name: z.string().min(1),
  contactName: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  countryCode: z.string().length(2).default("DE"),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().optional(),
  vatId: z.string().optional(),
  leitwegId: z.string().optional(),
  peppolId: z.string().optional(),
  // S1 (Fix-Welle Phase 7): null/fehlend = kein Kunden-Override (kaskadiert auf
  // Zahlungsmethode -> DocumentSettings.invoiceDueDays -> 14, siehe invoice/create.ts).
  defaultPaymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultPaymentMethodId: z.string().optional(),
  // Phase 7, §34 — frei editierbar; bleibt leer -> assignCustomerNumber bei der Anlage.
  customerNumber: z.string().max(30).optional(),
  notes: z.string().optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  // Frei vergebene Artikelnummer (Phase 4b) — wird als Snapshot in Positionen uebernommen,
  // kein Live-Bezug zum Produktstamm.
  articleNumber: z.string().max(60).optional(),
  unit: z.string().default("C62"),
  netPriceCents: z.number().int(),
  taxRate: TaxRate.default(19),
  taxCategory: TaxCategory.default("S"),
  differential: z.boolean().default(false),
});
export type ProductInput = z.infer<typeof productSchema>;

// ── Rechnung ─────────────────────────────────────────────────────────────
// lineType default "ITEM" haelt bestehende Aufrufer (ohne das Feld) abwaertskompatibel.
export const invoiceLineInputSchema = z
  .object({
    lineType: LineType.default("ITEM"),
    productId: z.string().optional(),
    description: z.string().min(1),
    // Rich-Text-Langbeschreibung (Markdown-Teilmenge, §9) — optionaler Zusatztext zur Position.
    descriptionLong: z.string().max(5000).optional(),
    // Artikelnummer-Snapshot zum Erfassungszeitpunkt (unabhaengig vom Produktstamm).
    articleNumber: z.string().max(60).optional(),
    quantityMilli: z.number().int(),
    unit: z.string().default("C62"),
    unitNetPriceCents: z.number().int(),
    taxRate: TaxRate,
    taxCategory: TaxCategory.default("S"),
    discountPermille: z.number().int().min(0).max(1000).default(0),
    discountCents: z.number().int().nonnegative().default(0),
  })
  .superRefine((line, ctx) => {
    if (line.lineType === "ITEM") {
      if (line.quantityMilli === 0) {
        ctx.addIssue({ code: "custom", message: "Menge darf nicht 0 sein", path: ["quantityMilli"] });
      }
      return;
    }
    // Nicht-ITEM (HEADING/TEXT/SUBTOTAL): keine Betraege — kein Menge-0-Workaround
    // fuers Rechnen (Lastenheft §8), diese Zeilen gehen nie in Summen/XML/Steuer.
    if (line.quantityMilli !== 0) {
      ctx.addIssue({ code: "custom", message: "Menge muss bei Nicht-Positionszeilen 0 sein", path: ["quantityMilli"] });
    }
    if (line.unitNetPriceCents !== 0) {
      ctx.addIssue({ code: "custom", message: "Einzelpreis muss bei Nicht-Positionszeilen 0 sein", path: ["unitNetPriceCents"] });
    }
    if (line.discountPermille !== 0) {
      ctx.addIssue({ code: "custom", message: "Rabatt muss bei Nicht-Positionszeilen 0 sein", path: ["discountPermille"] });
    }
    if (line.discountCents !== 0) {
      ctx.addIssue({ code: "custom", message: "Rabatt muss bei Nicht-Positionszeilen 0 sein", path: ["discountCents"] });
    }
    if (line.taxRate !== 0) {
      ctx.addIssue({ code: "custom", message: "Steuersatz muss bei Nicht-Positionszeilen 0 sein", path: ["taxRate"] });
    }
  });
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

// ── Beleg-Rabatt/-Aufschlag + Skonto (Phase 4a) ─────────────────────────────
// Gemeinsame Felder fuer Rechnung, Geschaeftsdokument und deren Update-Varianten.
// Skonto-Ziel 2 ist nur zusammen mit Ziel 1 und mit laengerer Frist zulaessig
// (sonst ergibt "2. Skonto" keinen Sinn — Ziel 1 muesste immer die kuerzere,
// hoehere Skontostufe sein).
const documentAdjustmentFields = {
  documentDiscountPermille: z.number().int().min(0).max(1000).default(0),
  documentDiscountCents: z.number().int().nonnegative().default(0),
  documentChargePermille: z.number().int().min(0).max(1000).default(0),
  documentChargeCents: z.number().int().nonnegative().default(0),
  documentChargeReason: z.string().max(500).optional(),
};

const skontoFields = {
  skonto1Permille: z.number().int().min(1).max(1000).optional(),
  skonto1Days: z.number().int().min(1).max(365).optional(),
  skonto2Permille: z.number().int().min(1).max(1000).optional(),
  skonto2Days: z.number().int().min(1).max(365).optional(),
  paymentMethodId: z.string().optional(),
};

function refineSkontoTargets<T extends { skonto1Permille?: number; skonto1Days?: number; skonto2Permille?: number; skonto2Days?: number }>(
  input: T,
  ctx: z.RefinementCtx<T>,
): void {
  const hasSkonto1 = input.skonto1Permille !== undefined || input.skonto1Days !== undefined;
  const hasSkonto2 = input.skonto2Permille !== undefined || input.skonto2Days !== undefined;

  if (hasSkonto1 && (input.skonto1Permille === undefined || input.skonto1Days === undefined)) {
    ctx.addIssue({ code: "custom", message: "Skonto 1 benoetigt Prozentsatz UND Tage.", path: ["skonto1Days"] });
  }
  if (hasSkonto2) {
    if (input.skonto2Permille === undefined || input.skonto2Days === undefined) {
      ctx.addIssue({ code: "custom", message: "Skonto 2 benoetigt Prozentsatz UND Tage.", path: ["skonto2Days"] });
    }
    if (!hasSkonto1 || input.skonto1Days === undefined) {
      ctx.addIssue({ code: "custom", message: "Skonto 2 ist nur zusammen mit Skonto 1 zulaessig.", path: ["skonto2Days"] });
    } else if (input.skonto2Days !== undefined && input.skonto2Days <= input.skonto1Days) {
      ctx.addIssue({ code: "custom", message: "Die Frist von Skonto 2 muss laenger sein als die von Skonto 1.", path: ["skonto2Days"] });
    }
    // G-Refine: Skonto 2 ist das SPAETERE, GUENSTIGERE Ziel — laengere Frist bei
    // niedrigerem Satz. Ohne diese Regel liesse sich ein Ziel 2 eintragen, das einen
    // hoeheren oder gleichen Skontosatz bei laengerer Frist gewaehrt (wirtschaftlich
    // widersinnig, verwirrt den Zahlungsvorschlag in detectSkonto).
    if (
      input.skonto1Permille !== undefined &&
      input.skonto2Permille !== undefined &&
      input.skonto2Permille >= input.skonto1Permille
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Der Prozentsatz von Skonto 2 muss niedriger sein als der von Skonto 1.",
        path: ["skonto2Permille"],
      });
    }
  }
}

// Gemeinsame Kopffelder fuer createInvoiceSchema/updateInvoiceSchema (Phase 4b: Betreff,
// Bestellnummer, interne Referenz, Ansprechpartner, Rechnungs-/Lieferadresse — analog
// den Feldern, die Quote seit Phase 3a traegt).
const invoiceHeaderFields = {
  customerId: z.string().min(1),
  type: InvoiceType.default("INVOICE"),
  taxScheme: TaxScheme.default("REGULAR"),
  // Phase 7 Fix-Runde 1: ohne explizite Angabe greift DocumentSettings.defaultCurrency
  // (Selbstheilung), zuletzt "EUR" — bewusst KEIN `.default()`, sonst koennte die
  // Domain "nicht gesetzt" nicht von "EUR" unterscheiden.
  currency: z.string().length(3).optional(),
  issueDate: z.coerce.date().optional(),
  deliveryDate: z.coerce.date().optional(),
  deliveryStart: z.coerce.date().optional(),
  deliveryEnd: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  buyerReference: z.string().optional(),
  subject: z.string().max(200).optional(),
  orderNumber: z.string().max(100).optional(),
  internalReference: z.string().max(100).optional(),
  // Fix-Welle (K2): explizit als null sendbar — der Client sendet null, wenn das Feld
  // im Editor geleert wurde, damit der Server die Referenz aktiv entfernt statt sie
  // unveraendert zu lassen (Zod-Boundary, Domain siehe invoice/update.ts).
  contactPersonId: z.string().nullable().optional(),
  billingAddressId: z.string().nullable().optional(),
  shippingAddressId: z.string().nullable().optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  headerText: z.string().max(5000).optional(),
  footerText: z.string().max(5000).optional(),
  internalNotes: z.string().optional(), // nur intern, nie im Beleg
  ...documentAdjustmentFields,
  ...skontoFields,
};

export const createInvoiceSchema = z
  .object({
    ...invoiceHeaderFields,
    lines: z.array(invoiceLineInputSchema).min(1),
  })
  .superRefine(refineSkontoTargets);
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

// Partial-Update (Phase 4b, src/domain/invoice/update.ts) — nur fuer DRAFT-Rechnungen.
// .partial() auf ...invoiceHeaderFields statt createInvoiceSchema.partial(), weil
// createInvoiceSchema bereits ein ZodEffects (superRefine) ist und .partial() nur auf
// ZodObject existiert.
export const updateInvoiceSchema = z
  .object({
    ...invoiceHeaderFields,
    lines: z.array(invoiceLineInputSchema).min(1).optional(),
  })
  .partial()
  // Fix-Runde 1: `type` (INVOICE/CREDIT_NOTE/CORRECTION) ist beim Bearbeiten eines
  // Entwurfs NICHT aenderbar — die Rechnungsart wird bei der Anlage festgelegt (§14
  // UStG-Belegcharakter haengt daran). .omit NACH .partial(), weil createInvoiceSchema
  // (die Quelle von invoiceHeaderFields) bereits ein ZodEffects ist und .omit nur auf
  // einem ZodObject existiert — updateInvoiceSchema baut sein eigenes ZodObject neu auf.
  .omit({ type: true })
  .superRefine(refineSkontoTargets);
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

// ── Teil-, Abschlags- und Schlussrechnungen (Phase 5, §13-15 UStG) ──────────
// mode bestimmt, welches der optionalen Felder Pflicht ist (per superRefine geprueft,
// analog refineSkontoTargets oben): PERCENT/NET_AMOUNT/GROSS_AMOUNT brauchen permille
// bzw. amountCents, POSITIONS lineIds, QUANTITIES quantities.
export const createPartialInvoiceSchema = z
  .object({
    sourceType: z.enum(["QUOTE", "DELIVERY_NOTE"]),
    sourceId: z.string().min(1),
    mode: z.enum(["PERCENT", "NET_AMOUNT", "GROSS_AMOUNT", "POSITIONS", "QUANTITIES"]),
    permille: z.number().int().min(1).max(1000).optional(),
    amountCents: z.number().int().positive().optional(),
    lineIds: z.array(z.string().min(1)).min(1).optional(),
    quantities: z
      .array(z.object({ sourceLineId: z.string().min(1), quantityMilli: z.number().int().positive() }))
      .min(1)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "PERCENT" && v.permille === undefined) {
      ctx.addIssue({ code: "custom", message: "permille ist bei mode PERCENT erforderlich", path: ["permille"] });
    }
    if ((v.mode === "NET_AMOUNT" || v.mode === "GROSS_AMOUNT") && v.amountCents === undefined) {
      ctx.addIssue({ code: "custom", message: "amountCents ist bei mode NET_AMOUNT/GROSS_AMOUNT erforderlich", path: ["amountCents"] });
    }
    if (v.mode === "POSITIONS" && v.lineIds === undefined) {
      ctx.addIssue({ code: "custom", message: "lineIds ist bei mode POSITIONS erforderlich", path: ["lineIds"] });
    }
    if (v.mode === "QUANTITIES" && v.quantities === undefined) {
      ctx.addIssue({ code: "custom", message: "quantities ist bei mode QUANTITIES erforderlich", path: ["quantities"] });
    }
  });
export type CreatePartialInvoiceInput = z.infer<typeof createPartialInvoiceSchema>;

export const createDownpaymentInvoiceSchema = z
  .object({
    sourceType: z.literal("QUOTE"),
    sourceId: z.string().min(1),
    mode: z.enum(["PERCENT", "AMOUNT"]),
    permille: z.number().int().min(1).max(1000).optional(),
    amountCents: z.number().int().positive().optional(),
    // Nur bei mode AMOUNT relevant: amountCents als Brutto- statt Nettobetrag lesen
    // (Rueckrechnung je Steuersatz-Bucket, src/lib/pricing/partial.ts#splitByTaxRate).
    amountIsGross: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "PERCENT" && v.permille === undefined) {
      ctx.addIssue({ code: "custom", message: "permille ist bei mode PERCENT erforderlich", path: ["permille"] });
    }
    if (v.mode === "AMOUNT" && v.amountCents === undefined) {
      ctx.addIssue({ code: "custom", message: "amountCents ist bei mode AMOUNT erforderlich", path: ["amountCents"] });
    }
  });
export type CreateDownpaymentInvoiceInput = z.infer<typeof createDownpaymentInvoiceSchema>;

export const createFinalInvoiceSchema = z.object({
  sourceType: z.literal("QUOTE"),
  sourceId: z.string().min(1),
});
export type CreateFinalInvoiceInput = z.infer<typeof createFinalInvoiceSchema>;

// ── Geschäftsdokumente (Angebot / Auftragsbestätigung / Proforma) ────────────
export const DocumentKind = z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

// Status des Angebots/der Auftragsbestätigung selbst. Die Umwandlung in eine Rechnung
// wird ueber Quote.convertedToInvoiceId nachgehalten, nicht mehr ueber den Status
// (vgl. Backfill-Migration phase3a_documents: vormals "CONVERTED" -> "ACCEPTED").
export const QuoteStatus = z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

const documentTextFields = {
  subject: z.string().max(200).optional(),
  headerText: z.string().max(5000).optional(),
  footerText: z.string().max(5000).optional(),
  deliveryTerms: z.string().max(2000).optional(),
  paymentTerms: z.string().max(2000).optional(),
  customerReference: z.string().max(200).optional(),
  // Fix-Welle (K2): siehe invoiceHeaderFields — explizit als null sendbar.
  contactPersonId: z.string().nullable().optional(),
  billingAddressId: z.string().nullable().optional(),
};

export const createDocumentSchema = z.object({
  kind: DocumentKind,
  customerId: z.string().min(1),
  taxScheme: TaxScheme.default("REGULAR"),
  // Phase 7 Fix-Runde 1: siehe invoiceHeaderFields — Fallback DocumentSettings.defaultCurrency.
  currency: z.string().length(3).optional(),
  validUntil: z.coerce.date().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  ...documentTextFields,
  ...documentAdjustmentFields,
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = createDocumentSchema.omit({ kind: true }).partial().extend({
  lines: z.array(invoiceLineInputSchema).min(1).optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const convertDocumentSchema = z.object({
  fromType: z.enum(["QUOTE", "INVOICE"]),
  fromId: z.string().min(1),
  toKind: z.enum(["AUFTRAGSBESTAETIGUNG", "INVOICE", "DELIVERY_NOTE"]),
  /** nur fuer DELIVERY_NOTE: Mengen je Quellposition (Default = Restmenge) */
  quantities: z.array(z.object({ sourceLineId: z.string().min(1), quantityMilli: z.number().int().nonnegative() })).optional(),
  deliveryDate: z.coerce.date().optional(),
});
export type ConvertDocumentInput = z.infer<typeof convertDocumentSchema>;

/** Body von POST /api/documents/[id]/convert und /api/invoices/[id]/delivery-note —
 *  fromType/fromId kommen dort aus der URL, nicht aus dem Body (Fix-Runde 1, Befund 2). */
export const convertDocumentBodySchema = convertDocumentSchema.omit({ fromType: true, fromId: true });
export type ConvertDocumentBodyInput = z.infer<typeof convertDocumentBodySchema>;

export const documentStatusActionSchema = z.object({
  action: z.enum(["MARK_SENT", "MARK_ACCEPTED", "MARK_REJECTED", "MARK_DELIVERED", "MARK_CREATED", "CANCEL", "ARCHIVE", "UNARCHIVE"]),
  note: z.string().max(1000).optional(),
});
export type DocumentStatusActionInput = z.infer<typeof documentStatusActionSchema>;

// ── Teilgutschrift ───────────────────────────────────────────────────────────
export const partialCreditSchema = z.object({
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantityMilli: z.number().int().refine((v) => v !== 0, "Menge darf nicht 0 sein"),
        unit: z.string().default("C62"),
        unitNetPriceCents: z.number().int(),
        taxRate: TaxRate,
        taxCategory: TaxCategory.default("S"),
      }),
    )
    .min(1),
});
export type PartialCreditInput = z.infer<typeof partialCreditSchema>;

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  paidAt: z.coerce.date().optional(),
  method: PaymentMethod.default("TRANSFER"),
  reference: z.string().optional(),
  isSkonto: z.boolean().default(false),
  // true: erkannter Skontoabzug wird sofort als zweite Zahlung gebucht (recordPayment).
  applySkonto: z.boolean().default(false),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// Query von GET /api/invoices/[id]/skonto-check (Phase 4a) — reine Vorschau ohne Schreiben.
export const skontoCheckQuerySchema = z.object({
  amountCents: z.coerce.number().int().positive(),
  paidAt: z.coerce.date().optional(),
});
export type SkontoCheckQuery = z.infer<typeof skontoCheckQuerySchema>;

// ── Wiederkehrende Rechnungen / Abos ─────────────────────────────────────────
export const RecurInterval = z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]);
export type RecurInterval = z.infer<typeof RecurInterval>;

export const createRecurringSchema = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1),
  interval: RecurInterval.default("MONTHLY"),
  intervalCount: z.number().int().min(1).max(48).default(1),
  anchorDay: z.number().int().min(1).max(28).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  taxScheme: TaxScheme.default("REGULAR"),
  // Phase 7 Fix-Runde 1: siehe invoiceHeaderFields — Fallback DocumentSettings.defaultCurrency.
  currency: z.string().length(3).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(14),
  // Ohne explizite Angabe greifen recurringAutoFinalizeDefault/recurringAutoSendDefault
  // (Phase 7, §33) — bewusst KEIN `.default()`, sonst koennte die Domain nicht mehr
  // unterscheiden, ob der Aufrufer bewusst false gewaehlt hat.
  autoFinalize: z.boolean().optional(),
  autoSend: z.boolean().optional(),
  notes: z.string().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;

export const updateRecurringStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "ENDED"]),
});
export type UpdateRecurringStatusInput = z.infer<typeof updateRecurringStatusSchema>;

// ── Phase 1: Dokumentketten, Lieferschein, Vorlagen, Stammdaten ──────────────
export const DocRefType = z.enum(["QUOTE", "INVOICE", "RECURRING", "DELIVERY_NOTE", "DUNNING"]);
export const RelationType = z.enum(["CONVERTED_TO", "CORRECTS", "REVERSES", "GENERATED_BY", "PARTIAL_OF", "DOWNPAYMENT_OF", "FINAL_FOR", "DELIVERED_BY", "DUPLICATED_FROM"]);
// INVOICED wird nicht gespeichert, sondern aus DocumentRelation (DELIVERED_BY-Gegenrichtung
// bzw. Rechnungsbezug) abgeleitet — daher kein eigener Statuswert hier.
export const DeliveryNoteStatus = z.enum(["DRAFT", "CREATED", "SENT", "DELIVERED", "CANCELLED"]);
export type DeliveryNoteStatus = z.infer<typeof DeliveryNoteStatus>;
export const BillingState = z.enum(["NONE", "PARTIAL", "FULL"]);
export type BillingState = z.infer<typeof BillingState>;
export const TextTemplatePosition = z.enum(["HEAD", "FOOT", "TERMS_DELIVERY", "TERMS_PAYMENT"]);
export const EmailLogStatus = z.enum(["QUEUED", "SENT", "DELIVERED", "BOUNCED", "FAILED"]);
export const AddressType = z.enum(["BILLING", "SHIPPING", "OTHER"]);

export const deliveryNoteLineInputSchema = z.object({
  description: z.string().min(1),
  articleNumber: z.string().optional(),
  quantityMilli: z.number().int().positive(),
  unit: z.string().min(1).default("C62"),
  sourceType: DocRefType.optional(),
  sourceId: z.string().optional(),
  sourceLineId: z.string().optional(),
  unitNetPriceCents: z.number().int().optional(),
  taxRate: z.number().int().optional(),
});
export const createDeliveryNoteSchema = z.object({
  customerId: z.string().min(1),
  sourceType: z.enum(["QUOTE", "INVOICE"]).optional(),
  sourceId: z.string().optional(),
  deliveryDate: z.coerce.date().optional(),
  shippingDate: z.coerce.date().optional(),
  // Ohne explizite Angabe greifen die dnShow*-Org-Einstellungen (Phase 7, §33) — bewusst
  // KEIN Zod-`.default()` hier, sonst wuerde die Domain nie unterscheiden koennen, ob der
  // Aufrufer den Wert bewusst gesetzt hat.
  showPrices: z.boolean().optional(),
  showTax: z.boolean().optional(),
  showArticleNumber: z.boolean().optional(),
  showDescription: z.boolean().optional(),
  showDeliveryAddress: z.boolean().optional(),
  headerText: z.string().max(5000).optional(),
  footerText: z.string().max(5000).optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  lines: z.array(deliveryNoteLineInputSchema).min(1),
});
export type CreateDeliveryNoteInput = z.infer<typeof createDeliveryNoteSchema>;

export const customerAddressSchema = z.object({
  type: AddressType, label: z.string().optional(), addressLine1: z.string().min(1), addressLine2: z.string().optional(),
  postalCode: z.string().min(1), city: z.string().min(1), countryCode: z.string().length(2).default("DE"), isDefault: z.boolean().default(false),
});
export const contactPersonSchema = z.object({
  firstName: z.string().min(1), lastName: z.string().min(1), role: z.string().optional(), phone: z.string().optional(),
  mobile: z.string().optional(), email: z.email().optional(), isDefault: z.boolean().default(false),
});
// K2 — UNTDID-4461-Codes, die der Zahlungsmethoden-Snapshot annehmen darf: exportierbar
// ohne Zusatzgruppen (58/30/10/68/97/1/ZZZ) sowie Karte (48/54/55) und Lastschrift (59),
// die der Mapper mit console.warn auf Code 1 zurueckfallen laesst (kein CardAccount/
// PaymentMandate-Support). Verhindert, dass der Betreiber beliebige Codes eintraegt.
export const UNTDID_PAYMENT_MEANS_CODES = [
  "58", "30", "10", "68", "97", "1", "ZZZ", "48", "54", "55", "59",
] as const;
export const paymentMethodSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_]+$/), name: z.string().min(1), description: z.string().optional(),
  paymentTermsDays: z.number().int().min(0).optional(), invoiceText: z.string().optional(), bankAccountRef: z.string().optional(),
  bankIban: z.string().optional(), bankBic: z.string().optional(), bankName: z.string().optional(),
  untdidCode: z.enum(UNTDID_PAYMENT_MEANS_CODES).default("ZZZ"), isActive: z.boolean().default(true), sortOrder: z.number().int().default(0),
});
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
export const dunningStageSchema = z.object({
  order: z.number().int().min(0), name: z.string().min(1), daysAfterDue: z.number().int().min(0), newDueDays: z.number().int().min(0).default(14),
  feeCents: z.number().int().min(0).default(0), calculateInterest: z.boolean(), includeB2BFlatFee: z.boolean(),
  emailTemplateId: z.string().optional(), documentTemplateId: z.string().optional(), enabled: z.boolean().default(true),
});

// ── Phase 6: Mahnwesen — Stufen, Einstellungen, Prozessstatus ───────────────────
// Nur die Felder, die der Client bei Create/Update mitschickt — OHNE `order`: das
// bestimmt die Domain (create: naechste freie Nummer; update: kennt die bestehende).
// COMPLIANCE §12: Mahnkosten (feeCents) sind erst ab der zweiten Mahnstufe zulaessig
// (Stufe 0 = Zahlungserinnerung, Stufe 1 = 1. Mahnung sind kostenfrei) — das kann diese
// Feldschema-Stufe allein nicht pruefen, weil sie `order` nicht kennt. Die Pruefung
// erfolgt in dunningStageInputSchema (order bekannt) bzw. in stages.ts (Domain).
export const dunningStageFieldsSchema = z.object({
  name: z.string().min(1).max(80),
  daysAfterDue: z.number().int().min(0),
  newDueDays: z.number().int().min(1).max(365),
  feeCents: z.number().int().min(0),
  calculateInterest: z.boolean(),
  includeB2BFlatFee: z.boolean(),
  emailTemplateId: z.string().nullable().optional(),
  autoSend: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type DunningStageFieldsInput = z.infer<typeof dunningStageFieldsSchema>;

// Vollstaendige Eingabe inkl. `order` — von der Domain (stages.ts) nach Ermittlung/
// Kenntnis der Stufennummer erneut geparst, damit die feeCents/order-Regel greift.
export const dunningStageInputSchema = dunningStageFieldsSchema
  .extend({ order: z.number().int().min(0) })
  .superRefine((v, ctx) => {
    if (v.feeCents > 0 && v.order < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["feeCents"],
        message: "Mahnkosten (feeCents) sind erst ab der 2. Mahnstufe zulässig (order ≥ 2, COMPLIANCE §12).",
      });
    }
  });
export type DunningStageInput = z.infer<typeof dunningStageInputSchema>;

export const dunningStagesReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type DunningStagesReorderInput = z.infer<typeof dunningStagesReorderSchema>;

export const dunningSettingsInputSchema = z.object({
  autoCreate: z.boolean().default(true),
  autoSend: z.boolean().default(false),
  baseInterestRateBp: z.number().int().min(0).max(2000).default(127),
  baseRateValidFrom: z.iso.date().nullable().optional(),
  gracePeriodDays: z.number().int().min(0).max(90).default(0),
});
export type DunningSettingsInput = z.infer<typeof dunningSettingsInputSchema>;

export const DunningState = z.enum(["ACTIVE", "PAUSED", "STOPPED"]);
export type DunningState = z.infer<typeof DunningState>;

// pausedUntil ist nur bei state === PAUSED erlaubt (sonst muss es fehlen/NULL sein) —
// das Feld beschreibt, bis wann der Prozess pausiert; bei ACTIVE/STOPPED ergibt es
// keinen Sinn und würde beim naechsten Read veraltete Information vorspiegeln.
// S1 (Fix-Welle): bei state=PAUSED ist pausedUntil PFLICHT und muss in der Zukunft
// liegen — vorher war "PAUSED ohne Datum" gueltig, create.ts las das als SOFORT
// abgelaufen und erstellte die naechste Mahnung trotzdem (stiller No-Op genau im
// dokumentierten Anwendungsfall "Ratenzahlung vereinbart").
export const dunningStateInputSchema = z
  .object({
    state: DunningState,
    pausedUntil: z.iso.date().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.state !== "PAUSED" && v.pausedUntil) {
      ctx.addIssue({
        code: "custom",
        path: ["pausedUntil"],
        message: "pausedUntil ist nur bei state=PAUSED zulässig.",
      });
    }
    if (v.state === "PAUSED") {
      if (!v.pausedUntil) {
        ctx.addIssue({
          code: "custom",
          path: ["pausedUntil"],
          message: "pausedUntil ist bei state=PAUSED Pflicht.",
        });
      } else {
        const today = new Date();
        const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        if (new Date(v.pausedUntil).getTime() <= todayUtc) {
          ctx.addIssue({
            code: "custom",
            path: ["pausedUntil"],
            message: "pausedUntil muss in der Zukunft liegen (nach heute).",
          });
        }
      }
    }
  });
export type DunningStateInput = z.infer<typeof dunningStateInputSchema>;

// Task 4: Filter fuer GET /api/dunning/overview (Query-String, daher alle Felder als
// String/optional — coerce fuer stageOrder).
export const dunningOverviewFilterSchema = z.object({
  customerId: z.string().min(1).optional(),
  state: DunningState.optional(),
  stageOrder: z.coerce.number().int().min(0).optional(),
});
export type DunningOverviewFilterInput = z.infer<typeof dunningOverviewFilterSchema>;
export const textTemplateSchema = z.object({ name: z.string().min(1), docType: DocType, position: TextTemplatePosition, body: z.string(), isDefault: z.boolean().default(false) });
export const emailTemplateSchema = z.object({ name: z.string().min(1), docType: DocType, subject: z.string().min(1), body: z.string(), signature: z.string().optional(), isDefault: z.boolean().default(false) });

// ── Phase 3a Task 5: Textvorlagen-Verwaltung, Statusaktionen, Restmengen-Query ───
export const textTemplateInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  docType: DocType,
  position: TextTemplatePosition,
  body: z.string().min(1).max(5000),
  isDefault: z.boolean().default(false),
});
export type TextTemplateInput = z.infer<typeof textTemplateInputSchema>;

export const textTemplatePickQuerySchema = z.object({
  docType: z.string().min(1),
  position: TextTemplatePosition,
});

export * from "./email";

// ── Phase 3b: Angebotsannahme — Einstellungen, Freigabe-Link, Entscheidung ──
// Die tatsaechlichen Schemas leben in ./quote-share (von den Domain-Funktionen direkt
// importiert); hier nur Re-Export fuer Aufrufer, die ueber den Sammelindex importieren
// (Task-2-Review, Auflage: quote-share.ts war zuvor nicht re-exportiert).
export * from "./quote-share";

// ── Phase 7: Belegeinstellungen, Briefpapier, Druckoptionen, Nummernkreise ──
export * from "./settings";

// ── Phase 4b: Beleganhaenge ──────────────────────────────────────────────────
// Whitelist ohne ausfuehrbare Formate (Global Constraint §38). Magic-Bytes-Pruefung
// erfolgt zusaetzlich in src/lib/attachments/mime.ts (sniffMime) — dieses Schema prueft
// nur den vom Client behaupteten MIME-Typ und die Groessenobergrenze.
export const ATTACHMENT_MIME_WHITELIST = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
] as const;

// 10 MB je Datei (Global Constraint §38) — aus src/lib/attachments/mime.ts uebernommen
// (eine Quelle, Fix-Runde 1). Die Obergrenze von 50 MB je Beleg wird von der
// Domain-Funktion addAttachment ueber die Summe bestehender Anhaenge geprueft, nicht hier.
export const MAX_ATTACHMENT_SIZE_BYTES = MAX_ATTACHMENT_FILE_BYTES;

// G6 (Fix-Welle): Steuerzeichen (inkl. CR/LF — Header-Injection in Content-Disposition/
// E-Mail-Anhangsnamen), Pfadtrenner und ".." sind im Dateinamen verboten — eine Stelle
// (dieses Schema), von der Domain (addAttachment) als einzigem Aufrufer genutzt.
const FORBIDDEN_FILENAME_CHARS = /[\x00-\x1f\x7f]|\/|\\|\.\./;

export const attachmentUploadSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((v) => !FORBIDDEN_FILENAME_CHARS.test(v), {
      message: "Dateiname enthaelt unzulaessige Zeichen (Steuerzeichen, '/', '\\' oder '..').",
    }),
  mime: z.enum(ATTACHMENT_MIME_WHITELIST),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_SIZE_BYTES),
});
export type AttachmentUploadInput = z.infer<typeof attachmentUploadSchema>;
