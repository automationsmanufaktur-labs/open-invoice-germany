import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import type { QuoteLine, InvoiceLine, DeliveryNoteLine } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeQuoteLine(l: QuoteLine) {
  return {
    id: l.id,
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
    lineNetCents: l.lineNetCents,
  };
}

export function serializeInvoiceLine(l: InvoiceLine) {
  return {
    id: l.id,
    position: l.position,
    lineType: l.lineType,
    productId: l.productId,
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
    lineNetCents: l.lineNetCents,
  };
}

export function serializeDeliveryNoteLine(l: DeliveryNoteLine) {
  return {
    id: l.id,
    position: l.position,
    sourceType: l.sourceType,
    sourceId: l.sourceId,
    sourceLineId: l.sourceLineId,
    description: l.description,
    articleNumber: l.articleNumber,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
    unitNetPriceCents: l.unitNetPriceCents,
    taxRate: l.taxRate,
  };
}


/**
 * OpenAPI-Response-Schemas (Phase 10, Task 4) fuer embed=lines — aus serializeQuoteLine/
 * serializeInvoiceLine/serializeDeliveryNoteLine abgeleitet.
 */
export const quoteLineSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  lineType: z.string(),
  description: z.string(),
  descriptionLong: z.string().nullable(),
  articleNumber: z.string().nullable(),
  quantityMilli: z.number().int(),
  unit: z.string(),
  unitNetPriceCents: z.number().int(),
  taxRate: z.number().int(),
  taxCategory: z.string(),
  discountPermille: z.number().int(),
  discountCents: z.number().int(),
  lineNetCents: z.number().int(),
});

export const invoiceLineSchema = quoteLineSchema.extend({
  productId: z.string().nullable(),
});

export const deliveryNoteLineSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceLineId: z.string().nullable(),
  description: z.string(),
  articleNumber: z.string().nullable(),
  quantityMilli: z.number().int(),
  unit: z.string(),
  unitNetPriceCents: z.number().int().nullable(),
  taxRate: z.number().int().nullable(),
});
