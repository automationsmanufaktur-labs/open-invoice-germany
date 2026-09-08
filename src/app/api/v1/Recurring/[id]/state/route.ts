/**
 * POST /api/v1/Recurring/{id}/state — Abo-Status setzen (ACTIVE/PAUSED/ENDED). Task 3,
 * task-3-facts.md: duenner Wrapper um `updateRecurringInvoice` (dieselbe Domain-Funktion
 * wie die Feld-Aenderung; `status` ist bereits Teil von `updateRecurringSchema`) — analog
 * dem MCP-Tool `set_recurring_state`, KEINE zweite Statuslogik (CLAUDE.md "nichts doppelt
 * bauen"). `updateRecurringInvoice` ist bereits org-gescoped (wirft `NotFoundError`).
 *
 * Fix-Runde 1 (Koordinator-Befund 2): liefert das vollstaendige, aktualisierte Abo
 * (statt {id,title,status}) — `updateRecurringInvoice` liefert die volle Zeile bereits
 * zurueck, kein zusaetzlicher Fetch noetig. `spec.response` nutzt `recurringSchema`.
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeRecurring, recurringSchema } from "@/api/serializers/recurring";
import { updateRecurringInvoice } from "@/domain/recurring/update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ state: z.enum(["ACTIVE", "PAUSED", "ENDED"]) });

export const POST = withApi<{ id: string }>(async (_req, ctx) => {
  const { state } = bodySchema.parse(ctx.body);
  const updated = await updateRecurringInvoice(ctx.orgId, ctx.params.id, { status: state }, ctx.actor);
  return apiData(serializeRecurring(updated));
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Recurring/{id}/state",
    method: "POST",
    summary: "Abo-Status setzen (pausieren/fortsetzen/beenden, liefert das aktualisierte Abo)",
    scope: "write",
    request: { body: bodySchema },
    response: apiDataResponseSchema(recurringSchema),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
