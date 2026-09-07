import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { z } from "zod";
import { iso } from "./common";
import { serializeDeliveryNoteLine, deliveryNoteLineSchema } from "./lines";
import type { DeliveryNote, DeliveryNoteLine, Customer } from "@/generated/prisma/client";

export type DeliveryNoteWithOptionalRelations = DeliveryNote & { lines?: DeliveryNoteLine[]; customer?: Customer };

export function serializeDeliveryNote(dn: DeliveryNoteWithOptionalRelations, embed: Set<string>) {
  return {
    objectName: "DeliveryNote" as const,
    id: dn.id,
    number: dn.number,
    status: dn.status,
    customerId: dn.customerId,
    contactPersonId: dn.contactPersonId,
    shippingAddressId: dn.shippingAddressId,
    issueDate: iso(dn.issueDate),
    deliveryDate: iso(dn.deliveryDate),
    shippingDate: iso(dn.shippingDate),
    showPrices: dn.showPrices,
    showTax: dn.showTax,
    showArticleNumber: dn.showArticleNumber,
    showDescription: dn.showDescription,
    showDeliveryAddress: dn.showDeliveryAddress,
    notes: dn.notes,
    headerText: dn.headerText,
    footerText: dn.footerText,
    sourceType: dn.sourceType,
    sourceId: dn.sourceId,
    sentAt: iso(dn.sentAt),
    deliveredAt: iso(dn.deliveredAt),
    archivedAt: iso(dn.archivedAt),
    createdAt: iso(dn.createdAt),
    updatedAt: iso(dn.updatedAt),
    ...(embed.has("customer") && dn.customer ? { customerName: dn.customer.name } : {}),
    ...(embed.has("lines") ? { lines: (dn.lines ?? []).map(serializeDeliveryNoteLine) } : {}),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeDeliveryNote abgeleitet. */
export const deliveryNoteSchema = z.object({
  objectName: z.literal("DeliveryNote"),
  id: z.string(),
  number: z.string().nullable(),
  status: z.string(),
  customerId: z.string(),
  contactPersonId: z.string().nullable(),
  shippingAddressId: z.string().nullable(),
  issueDate: z.string().nullable(),
  deliveryDate: z.string().nullable(),
  shippingDate: z.string().nullable(),
  showPrices: z.boolean(),
  showTax: z.boolean(),
  showArticleNumber: z.boolean(),
  showDescription: z.boolean(),
  showDeliveryAddress: z.boolean(),
  notes: z.string().nullable(),
  headerText: z.string().nullable(),
  footerText: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  customerName: z.string().optional(),
  lines: z.array(deliveryNoteLineSchema).optional(),
});
