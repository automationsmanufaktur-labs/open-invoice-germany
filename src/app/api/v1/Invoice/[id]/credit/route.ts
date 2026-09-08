/**
 * POST /api/v1/Invoice/{id}/credit — Teilgutschrift zu einer festgeschriebenen Rechnung
 * (Original bleibt erhalten; fuer einen Vollstorno: /cancel). Task 3, task-3-facts.md:
 * ruft exakt `createPartialCreditNote` mit demselben Zod-Schema wie die Session-Route
 * (`partialCreditSchema`, src/schemas).
 *
 * Fix-Runde 1 (Koordinator-Befund 2): liefert die vollstaendige TEILGUTSCHRIFT (die
 * neu erzeugte Invoice, type CREDIT_NOTE) statt nur {creditNoteId,creditNoteNumber,
 * originalNumber} — `createPartialCreditNote` laedt sie ohnehin bereits komplett.
 */
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeInvoice, invoiceSchema } from "@/api/serializers/invoice";
import { createPartialCreditNote } from "@/domain/invoice/credit";
import { partialCreditSchema } from "@/schemas";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await prisma.invoice.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId }, select: { id: true } });
  if (!existing) throw new NotFoundError("Rechnung nicht gefunden.");
  const input = partialCreditSchema.parse(ctx.body);
  const res = await createPartialCreditNote(ctx.params.id, input, { actor: ctx.actor });
  return apiData(serializeInvoice(res.creditNote, new Set()), 201);
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Invoice/{id}/credit",
    method: "POST",
    summary: "Teilgutschrift zu einer Rechnung anlegen (liefert die erzeugte Gutschrift)",
    scope: "write",
    request: { body: partialCreditSchema },
    response: apiDataResponseSchema(invoiceSchema),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
