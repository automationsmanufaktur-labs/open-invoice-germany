import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { Dunning } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeDunning(d: Dunning) {
  return {
    objectName: "Dunning" as const,
    id: d.id,
    invoiceId: d.invoiceId,
    stageId: d.stageId,
    number: d.number,
    level: d.level,
    sentAt: iso(d.sentAt),
    dueDate: iso(d.dueDate),
    baseInterestRatePermille: d.baseInterestRatePermille,
    interestRatePoints: d.interestRatePoints,
    interestAmountCents: d.interestAmountCents,
    lateFeeCents: d.lateFeeCents,
    flatFee40Cents: d.flatFee40Cents,
    claimBaseCents: d.claimBaseCents,
    feeCents: d.feeCents,
    invoiceNumber: d.invoiceNumber,
    invoiceDueDate: iso(d.invoiceDueDate),
    createdBy: d.createdBy,
    createdAt: iso(d.createdAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeDunning abgeleitet. */
export const dunningSchema = z.object({
  objectName: z.literal("Dunning"),
  id: z.string(),
  invoiceId: z.string(),
  stageId: z.string().nullable(),
  number: z.string().nullable(),
  level: z.number().int(),
  sentAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  baseInterestRatePermille: z.number().int().nullable(),
  interestRatePoints: z.number().int().nullable(),
  interestAmountCents: z.number().int(),
  lateFeeCents: z.number().int(),
  flatFee40Cents: z.number().int(),
  claimBaseCents: z.number().int(),
  feeCents: z.number().int(),
  invoiceNumber: z.string().nullable(),
  invoiceDueDate: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string().nullable(),
});
