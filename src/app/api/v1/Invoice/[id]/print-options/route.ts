/**
 * GET/PATCH /api/v1/Invoice/{id}/print-options — Beleg-individuelle Druckoptionen (§36)
 * inkl. optionalem PDF-Layout-Override (Phase 11b).
 *
 * Fix-Welle (Abschluss-Review Phase 11b, Block 5, "Known gap (a)"): bisher nur ueber MCP
 * (`set_print_options`) und die UI-Route (`PUT /api/invoices/[id]/print-options`)
 * erreichbar — dieselbe Domain-Funktion (`setPrintOptions`), dieselbe Zod-Validierung
 * (`printOptionsOverrideSchema`), kein Bypass-Pfad (§55). PATCH statt PUT: `RouteSpec`
 * kennt nur GET/POST/PATCH (siehe src/api/spec.ts), und `setPrintOptions` ERSETZT die
 * Ueberschreibung ohnehin als Ganzes (kein Merge) — inhaltlich identisch zur UI-Route.
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
  const invoice = await prisma.invoice.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId }, select: { printOptionsJson: true } });
  if (!invoice) throw new NotFoundError("Rechnung nicht gefunden.");
  const global = await loadPrintSettings(ctx.orgId);
  return apiData(effectivePrintOptions(global, invoice.printOptionsJson));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const override = await setPrintOptions(ctx.orgId, { kind: "INVOICE", id: ctx.params.id }, ctx.body);
  return apiData(override);
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/Invoice/{id}/print-options",
    method: "GET",
    summary: "Effektive Druckoptionen der Rechnung (globale Einstellungen verschmolzen mit einer etwaigen Beleg-Ueberschreibung)",
    scope: "read",
    response: apiDataResponseSchema(effectivePrintOptionsSchema),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/Invoice/{id}/print-options",
    method: "PATCH",
    summary: "Beleg-individuelle Druckoptionen setzen (ersetzt die Ueberschreibung als Ganzes, kein Merge) — nur solange die Rechnung im Entwurf (DRAFT) ist",
    scope: "write",
    request: { body: printOptionsOverrideSchema },
    response: apiDataResponseSchema(printOptionsOverrideSchema),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
