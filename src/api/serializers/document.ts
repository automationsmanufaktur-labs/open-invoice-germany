/**
 * Serialisierer fuer Quote/OrderConfirmation (Kind ANGEBOT bzw. AUFTRAGSBESTAETIGUNG des
 * Quote-Modells, siehe src/domain/document/list.ts `kind`) — `objectName` wird vom Aufrufer
 * (Route) uebergeben, da beide Ressourcen dieselbe Prisma-Tabelle nutzen. NIE `internalNotes`.
 */
import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { z } from "zod";
import { iso } from "./common";
import { serializeQuoteLine, quoteLineSchema } from "./lines";
import type { Quote, QuoteLine, Customer } from "@/generated/prisma/client";

export type QuoteWithOptionalLines = Quote & { lines?: QuoteLine[]; customer?: Customer };

export function serializeQuote(q: QuoteWithOptionalLines, objectName: "Quote" | "OrderConfirmation", embed: Set<string>) {
  return {
    objectName,
    id: q.id,
    number: q.number,
    kind: q.kind,
    status: q.status,
    customerId: q.customerId,
    contactPersonId: q.contactPersonId,
    billingAddressId: q.billingAddressId,
    issueDate: iso(q.issueDate),
    validUntil: iso(q.validUntil),
    currency: q.currency,
    taxScheme: q.taxScheme,
    subject: q.subject,
    notes: q.notes,
    headerText: q.headerText,
    footerText: q.footerText,
    deliveryTerms: q.deliveryTerms,
    paymentTerms: q.paymentTerms,
    customerReference: q.customerReference,
    documentDiscountPermille: q.documentDiscountPermille,
    documentDiscountCents: q.documentDiscountCents,
    documentChargePermille: q.documentChargePermille,
    documentChargeCents: q.documentChargeCents,
    documentChargeReason: q.documentChargeReason,
    netTotalCents: q.netTotalCents,
    taxTotalCents: q.taxTotalCents,
    grossTotalCents: q.grossTotalCents,
    convertedToInvoiceId: q.convertedToInvoiceId,
    sentAt: iso(q.sentAt),
    decidedAt: iso(q.decidedAt),
    decisionNote: q.decisionNote,
    archivedAt: iso(q.archivedAt),
    createdAt: iso(q.createdAt),
    updatedAt: iso(q.updatedAt),
    ...(embed.has("customer") && q.customer ? { customerName: q.customer.name } : {}),
    ...(embed.has("lines") ? { lines: (q.lines ?? []).map(serializeQuoteLine) } : {}),
  };
}


/**
 * OpenAPI-Response-Schemas (Phase 10, Task 4) fuer Quote/OrderConfirmation — aus
 * serializeQuote abgeleitet (gemeinsame Form, `objectName` unterscheidet die beiden
 * Ressourcen wie beim Serialisierer selbst).
 */
const documentBaseSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  kind: z.string(),
  status: z.string(),
  customerId: z.string(),
  contactPersonId: z.string().nullable(),
  billingAddressId: z.string().nullable(),
  issueDate: z.string().nullable(),
  validUntil: z.string().nullable(),
  currency: z.string(),
  taxScheme: z.string(),
  subject: z.string().nullable(),
  notes: z.string().nullable(),
  headerText: z.string().nullable(),
  footerText: z.string().nullable(),
  deliveryTerms: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  customerReference: z.string().nullable(),
  documentDiscountPermille: z.number().int(),
  documentDiscountCents: z.number().int(),
  documentChargePermille: z.number().int(),
  documentChargeCents: z.number().int(),
  documentChargeReason: z.string().nullable(),
  netTotalCents: z.number().int(),
  taxTotalCents: z.number().int(),
  grossTotalCents: z.number().int(),
  convertedToInvoiceId: z.string().nullable(),
  sentAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  customerName: z.string().optional(),
  lines: z.array(quoteLineSchema).optional(),
});

export const quoteSchema = documentBaseSchema.extend({ objectName: z.literal("Quote") });
export const orderConfirmationSchema = documentBaseSchema.extend({ objectName: z.literal("OrderConfirmation") });
