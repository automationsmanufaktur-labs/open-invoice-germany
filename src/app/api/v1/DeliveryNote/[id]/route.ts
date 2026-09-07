/**
 * GET one — kein PATCH (Deviation, siehe task-2-report.md): es existiert keine
 * `updateDraft*`-Domain-Funktion fuer Lieferscheine (anders als Invoice/Quote/Document) —
 * das Neubauen einer solchen Funktion (Positionen/Mengen neu berechnen, Ueberlieferungs-
 * Pruefung via assertNoOverDelivery) ist nicht durch task-2-facts.md gedeckt (die Facts
 * verlangen nur neue List-Funktionen fuer Ressourcen ohne Listen-Domain, DeliveryNote hat
 * bereits eine ueber listDeliveryNotes). Empfehlung: eigener Task, sobald die UI selbst
 * Lieferschein-Entwuerfe bearbeitbar macht (Stand Task 2: auch dort kein PATCH).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeDeliveryNote } from "@/api/serializers/delivery-note";
import { parseEmbed } from "@/api/serializers/common";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const embed = parseEmbed(searchParams);
  const row = await prisma.deliveryNote.findFirst({
    where: { id: ctx.params.id, orgId: ctx.orgId },
    include: { lines: embed.has("lines"), customer: embed.has("customer") },
  });
  if (!row) throw new NotFoundError("Lieferschein nicht gefunden.");
  return apiData(serializeDeliveryNote(row, embed));
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/DeliveryNote/{id}",
    method: "GET",
    summary: "Lieferschein abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
