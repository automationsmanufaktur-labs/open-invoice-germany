/**
 * Serialisierer fuer Recurring (=RecurringInvoice, Fix-Runde 1, Koordinator-Ruling b,
 * Task 3, Phase 10). Kein Beleg (kein GoBD-Bezug) — dennoch nie `notes` unreflektiert
 * als "intern" behandeln: `notes` ist hier das oeffentliche Notizfeld des Abos (analog
 * Contact.notes), es gibt kein separates `internalNotes` auf diesem Modell.
 */
import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { iso } from "./common";
import type { RecurringInvoice } from "@/generated/prisma/client";
import { z } from "zod";

export function serializeRecurring(r: RecurringInvoice) {
  return {
    objectName: "Recurring" as const,
    id: r.id,
    customerId: r.customerId,
    title: r.title,
    status: r.status,
    interval: r.interval,
    intervalCount: r.intervalCount,
    anchorDay: r.anchorDay,
    startDate: iso(r.startDate),
    nextRunDate: r.status === "ENDED" ? null : iso(r.nextRunDate),
    endDate: iso(r.endDate),
    maxRuns: r.maxRuns,
    taxScheme: r.taxScheme,
    currency: r.currency,
    paymentTermsDays: r.paymentTermsDays,
    notes: r.notes,
    autoFinalize: r.autoFinalize,
    autoSend: r.autoSend,
    emailTemplateId: r.emailTemplateId,
    showPeriodText: r.showPeriodText,
    lastRunAt: iso(r.lastRunAt),
    issuedCount: r.issuedCount,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}


/** OpenAPI-Response-Schema (Phase 10, Task 4) — aus serializeRecurring abgeleitet. */
export const recurringSchema = z.object({
  objectName: z.literal("Recurring"),
  id: z.string(),
  customerId: z.string(),
  title: z.string(),
  status: z.string(),
  interval: z.string(),
  intervalCount: z.number().int(),
  anchorDay: z.number().int().nullable(),
  startDate: z.string().nullable(),
  nextRunDate: z.string().nullable(),
  endDate: z.string().nullable(),
  maxRuns: z.number().int().nullable(),
  taxScheme: z.string(),
  currency: z.string(),
  paymentTermsDays: z.number().int(),
  notes: z.string().nullable(),
  autoFinalize: z.boolean(),
  autoSend: z.boolean(),
  emailTemplateId: z.string().nullable(),
  showPeriodText: z.boolean(),
  lastRunAt: z.string().nullable(),
  issuedCount: z.number().int(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
