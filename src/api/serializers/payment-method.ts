import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { PaymentMethod } from "@/generated/prisma/client";
import { z } from "zod";

export function serializePaymentMethod(m: PaymentMethod) {
  return {
    objectName: "PaymentMethod" as const,
    id: m.id,
    code: m.code,
    name: m.name,
    description: m.description,
    paymentTermsDays: m.paymentTermsDays,
    invoiceText: m.invoiceText,
    bankAccountRef: m.bankAccountRef,
    bankIban: m.bankIban,
    bankBic: m.bankBic,
    bankName: m.bankName,
    untdidCode: m.untdidCode,
    isSystem: m.isSystem,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializePaymentMethod abgeleitet. */
export const paymentMethodSchema = z.object({
  objectName: z.literal("PaymentMethod"),
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  paymentTermsDays: z.number().int().nullable(),
  invoiceText: z.string().nullable(),
  bankAccountRef: z.string().nullable(),
  bankIban: z.string().nullable(),
  bankBic: z.string().nullable(),
  bankName: z.string().nullable(),
  untdidCode: z.string(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
