/**
 * POST /api/v1/Recurring/{id}/run — faellige Rechnung fuer EIN Abo sofort erzeugen.
 * Task 3, task-3-facts.md: ruft exakt `emitRecurringNow` (dieselbe Domain-Funktion wie
 * das MCP-Tool `run_recurring`). Kein Basis-Ressourcen-Endpunkt `/api/v1/Recurring`
 * (Liste/Anlegen) ist Teil dieses Tasks — task-3-facts.md nennt nur "recurring
 * update/run" (siehe /state fuer den Status-Wrapper um `updateRecurringInvoice`).
 * `emitRecurringNow` kennt keinen eigenen orgId-Guard (Signatur `(recurringId, opts)`) —
 * die Route prueft die Organisationszugehoerigkeit deshalb selbst vorab.
 *
 * Fix-Runde 1 (Koordinator-Befund 2): liefert das erzeugte DOKUMENT — die vollstaendige
 * neu erzeugte Rechnung (statt {invoiceId,number,finalized,periodDate}) — `run`
 * "returns a document" (Koordinator-Wortlaut); `spec.response` nutzt `invoiceSchema`.
 * Das Abo selbst (Recurring) bleibt unveraendert ueber `GET /api/v1/Recurring/{id}`
 * abrufbar (`lastRunAt`/`issuedCount`/`nextRunDate` zeigen den Lauf).
 */
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeInvoice, invoiceSchema } from "@/api/serializers/invoice";
import { emitRecurringNow } from "@/domain/recurring/run";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await prisma.recurringInvoice.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId }, select: { id: true } });
  if (!existing) throw new NotFoundError("Abo nicht gefunden.");
  const result = await emitRecurringNow(ctx.params.id, { actor: ctx.actor });
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId }, include: { lines: { orderBy: { position: "asc" } } } });
  return apiData(serializeInvoice(invoice, new Set()), 201);
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Recurring/{id}/run",
    method: "POST",
    summary: "Faellige Rechnung fuer ein Abo sofort erzeugen (liefert die erzeugte Rechnung)",
    scope: "write",
    response: apiDataResponseSchema(invoiceSchema),
    errors: [401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
