/**
 * GET/PATCH /api/v1/DeliveryNote/{id}/print-options — siehe
 * Invoice/[id]/print-options/route.ts fuer die ausfuehrliche Begruendung (Fix-Welle,
 * Abschluss-Review Block 5 "Known gap (a)").
 */
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { effectivePrintOptionsSchema } from "@/api/serializers/print-options";
import { setPrintOptions, loadPrintSettings, effectivePrintOptions } from "@/domain/settings/print";
import { printOptionsOverrideSchema } from "@/schemas";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const deliveryNote = await prisma.deliveryNote.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId }, select: { printOptionsJson: true } });
  if (!deliveryNote) throw new NotFoundError("Lieferschein nicht gefunden.");
  const global = await loadPrintSettings(ctx.orgId);
  return apiData(effectivePrintOptions(global, deliveryNote.printOptionsJson));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const override = await setPrintOptions(ctx.orgId, { kind: "DELIVERY_NOTE", id: ctx.params.id }, ctx.body);
  return apiData(override);
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/DeliveryNote/{id}/print-options",
    method: "GET",
    summary: "Effektive Druckoptionen des Lieferscheins (globale Einstellungen verschmolzen mit einer etwaigen Beleg-Ueberschreibung)",
    scope: "read",
    response: apiDataResponseSchema(effectivePrintOptionsSchema),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/DeliveryNote/{id}/print-options",
    method: "PATCH",
    summary: "Beleg-individuelle Druckoptionen setzen (ersetzt die Ueberschreibung als Ganzes, kein Merge) — nur solange der Lieferschein im Entwurf (DRAFT) ist",
    scope: "write",
    request: { body: printOptionsOverrideSchema },
    response: apiDataResponseSchema(printOptionsOverrideSchema),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
