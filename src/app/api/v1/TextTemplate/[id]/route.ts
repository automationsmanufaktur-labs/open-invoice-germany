import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeTextTemplate } from "@/api/serializers/text-template";
import { saveTextTemplate, TemplateNotFoundError, SystemTemplateProtectedError, TemplateNameConflictError } from "@/domain/text-template/manage";
import { textTemplateInputSchema } from "@/schemas";
import { dbInternal } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.textTemplate.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Vorlage nicht gefunden.");
  return apiData(serializeTextTemplate(row));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await dbInternal.textTemplate.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!existing) throw new NotFoundError("Vorlage nicht gefunden.");
  try {
    const updated = await saveTextTemplate(ctx.orgId, { ...(ctx.body as object), id: ctx.params.id });
    return apiData(serializeTextTemplate(updated));
  } catch (e) {
    if (e instanceof TemplateNotFoundError) throw new NotFoundError("Vorlage nicht gefunden.");
    if (e instanceof SystemTemplateProtectedError || e instanceof TemplateNameConflictError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/TextTemplate/{id}",
    method: "GET",
    summary: "Textvorlage abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/TextTemplate/{id}",
    method: "PATCH",
    summary: "Textvorlage aktualisieren",
    scope: "write",
    request: { body: textTemplateInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
