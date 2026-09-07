/**
 * Zod-Schemas — Validierung an jedem Boundary (API-Routes, Formulare).
 * Ersetzen zugleich die fehlenden Prisma-Enums (DB hält Strings).
 */
import { z } from "zod";
import { isValidIban, normalizeIban } from "@/lib/iban";

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

export const CustomerType = z.enum(["BUSINESS", "CONSUMER"]);
export const InvoiceType = z.enum(["INVOICE", "CREDIT_NOTE", "CORRECTION"]);
export const DocType = z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA", "INVOICE", "CREDIT_NOTE", "DUNNING", "DELIVERY_NOTE", "CUSTOMER", "PRODUCT"]);
// Codes kommen aus der Tabelle PaymentMethod (Stammdaten je Organisation); die
// Pruefung auf Existenz/Zugehoerigkeit erfolgt in recordPayment, nicht hier.
export const PaymentMethod = z.string().min(1).max(40);

// ── Beleg-Snapshots (Phase 0) ────────────────────────────────────────────────
// Feldgenau identisch mit MapInput.org / MapInput.customer in src/lib/einvoice/mapper.ts.
// Ein Unit-Test prueft die Schluesselmengen gegeneinander.
export const SnapshotSource = z.enum(["FINALIZE", "CREATE", "MIGRATION", "INHERITED"]);
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
  defaultPaymentTermsDays: z.number().int().min(0).max(365).default(14),
  notes: z.string().optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().default("C62"),
  netPriceCents: z.number().int(),
  taxRate: TaxRate.default(19),
  taxCategory: TaxCategory.default("S"),
  differential: z.boolean().default(false),
});
export type ProductInput = z.infer<typeof productSchema>;

// ── Rechnung ─────────────────────────────────────────────────────────────
export const invoiceLineInputSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1),
  quantityMilli: z.number().int().refine((v) => v !== 0, "Menge darf nicht 0 sein"),
  unit: z.string().default("C62"),
  unitNetPriceCents: z.number().int(),
  taxRate: TaxRate,
  taxCategory: TaxCategory.default("S"),
  discountPermille: z.number().int().min(0).max(1000).default(0),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

export const createInvoiceSchema = z.object({
  customerId: z.string().min(1),
  type: InvoiceType.default("INVOICE"),
  taxScheme: TaxScheme.default("REGULAR"),
  currency: z.string().length(3).default("EUR"),
  issueDate: z.coerce.date().optional(),
  deliveryDate: z.coerce.date().optional(),
  deliveryStart: z.coerce.date().optional(),
  deliveryEnd: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  buyerReference: z.string().optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  internalNotes: z.string().optional(), // nur intern, nie im Beleg
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

// ── Geschäftsdokumente (Angebot / Auftragsbestätigung / Proforma) ────────────
export const DocumentKind = z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const createDocumentSchema = z.object({
  kind: DocumentKind,
  customerId: z.string().min(1),
  taxScheme: TaxScheme.default("REGULAR"),
  currency: z.string().length(3).default("EUR"),
  validUntil: z.coerce.date().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

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
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

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
  currency: z.string().length(3).default("EUR"),
  paymentTermsDays: z.number().int().min(0).max(365).default(14),
  autoFinalize: z.boolean().default(false),
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
export const RelationType = z.enum(["CONVERTED_TO", "CORRECTS", "REVERSES", "GENERATED_BY", "PARTIAL_OF", "DOWNPAYMENT_OF", "FINAL_FOR", "DELIVERED_BY"]);
export const DeliveryNoteStatus = z.enum(["DRAFT", "CREATED", "SENT", "DELIVERED", "INVOICED", "CANCELLED"]);
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
});
export const createDeliveryNoteSchema = z.object({
  customerId: z.string().min(1),
  deliveryDate: z.coerce.date().optional(),
  shippingDate: z.coerce.date().optional(),
  showPrices: z.boolean().default(false),
  showTax: z.boolean().default(false),
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
export const paymentMethodSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_]+$/), name: z.string().min(1), description: z.string().optional(),
  paymentTermsDays: z.number().int().min(0).optional(), invoiceText: z.string().optional(), bankAccountRef: z.string().optional(),
  untdidCode: z.string().min(1).default("ZZZ"), isActive: z.boolean().default(true), sortOrder: z.number().int().default(0),
});
export const dunningStageSchema = z.object({
  order: z.number().int().min(0), name: z.string().min(1), daysAfterDue: z.number().int().min(0), newDueDays: z.number().int().min(0).default(14),
  feeCents: z.number().int().min(0).default(0), calculateInterest: z.boolean(), includeB2BFlatFee: z.boolean(),
  emailTemplateId: z.string().optional(), documentTemplateId: z.string().optional(), enabled: z.boolean().default(true),
});
export const textTemplateSchema = z.object({ name: z.string().min(1), docType: DocType, position: TextTemplatePosition, body: z.string(), isDefault: z.boolean().default(false) });
export const emailTemplateSchema = z.object({ name: z.string().min(1), docType: DocType, subject: z.string().min(1), body: z.string(), signature: z.string().optional(), isDefault: z.boolean().default(false) });
