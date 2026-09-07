/**
 * POST /api/v1/Invoice/{id}/cancel — Rechnung stornieren (GoBD-konforme Storno-Gutschrift,
 * Original bleibt erhalten). Task 3, task-3-facts.md: ruft exakt `cancelInvoice`.
 *
 * Fix-Runde 1 (Koordinator-Befund 2): liefert die vollstaendige STORNO-GUTSCHRIFT
 * (die neu erzeugte Invoice, type CREDIT_NOTE) statt nur {originalNumber,creditNoteId,
 * creditNoteNumber} — `cancelInvoice` laedt sie ohnehin bereits komplett (inkl.
 * `lines`/`customer`, siehe `finalizeWithinTx`). Die ORIGINAL-Rechnung bleibt unter
 * `ctx.params.id`/ihrer eigenen Nummer weiter abrufbar (`GET /api/v1/Invoice/{id}`,
 * jetzt `status: "CANCELLED"`, `reversedByInvoiceId` zeigt auf die Gutschrift).
 */
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeInvoice, invoiceSchema } from "@/api/serializers/invoice";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await prisma.invoice.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId }, select: { id: true } });
  if (!existing) throw new NotFoundError("Rechnung nicht gefunden.");
  const result = await cancelInvoice(ctx.params.id, { actor: ctx.actor });
  return apiData(serializeInvoice(result.creditNote, new Set()));
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Invoice/{id}/cancel",
    method: "POST",
    summary: "Rechnung stornieren (liefert die erzeugte Storno-Gutschrift)",
    scope: "write",
    response: apiDataResponseSchema(invoiceSchema),
    errors: [401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
