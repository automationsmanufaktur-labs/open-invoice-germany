/**
 * Zod-Schemas — Validierung an jedem Boundary (API-Routes, Formulare).
 * Ersetzen zugleich die fehlenden Prisma-Enums (DB hält Strings).
 */
import { z } from "zod";

// ── Enumerationen ────────────────────────────────────────────────────────
export const TaxScheme = z.enum([
  "REGULAR",
  "KLEINUNTERNEHMER",
  "DIFFERENZ",
  "REVERSE_CHARGE",
  "IG_LIEFERUNG",
  "IG_LEISTUNG",
]);
export type TaxScheme = z.infer<typeof TaxScheme>;

export const TaxCategory = z.enum(["S", "AE", "K", "G", "E", "Z"]);
export type TaxCategory = z.infer<typeof TaxCategory>;

export const TaxRate = z.union([z.literal(19), z.literal(7), z.literal(0)]);

export const CustomerType = z.enum(["BUSINESS", "CONSUMER"]);
export const InvoiceType = z.enum(["INVOICE", "CREDIT_NOTE", "CORRECTION"]);
export const DocType = z.enum(["QUOTE", "INVOICE", "CREDIT_NOTE", "DUNNING"]);
export const PaymentMethod = z.enum(["TRANSFER", "CASH", "CARD", "SEPA"]);

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
  iban: z.string().optional(),
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
