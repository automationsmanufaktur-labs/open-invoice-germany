import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeEmailTemplate } from "@/api/serializers/email-template";
import { saveEmailTemplate, TemplateNotFoundError, SystemTemplateProtectedError, TemplateNameConflictError } from "@/domain/email/templates";
import { emailTemplateInputSchema } from "@/schemas";
import { dbInternal } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await dbInternal.emailTemplate.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("Vorlage nicht gefunden.");
  return apiData(serializeEmailTemplate(row));
}, { scope: "read" });

export const PATCH = withApi<{ id: string }>(async (_req, ctx) => {
  const existing = await dbInternal.emailTemplate.findFirst({ where: { id: ctx.params.id, orgId: ctx.orgId } });
  if (!existing) throw new NotFoundError("Vorlage nicht gefunden.");
  const input = emailTemplateInputSchema.parse({ ...(ctx.body as object), id: ctx.params.id });
  try {
    const updated = await saveEmailTemplate(ctx.orgId, input);
    return apiData(serializeEmailTemplate(updated));
  } catch (e) {
    if (e instanceof TemplateNotFoundError) throw new NotFoundError("Vorlage nicht gefunden.");
    if (e instanceof SystemTemplateProtectedError || e instanceof TemplateNameConflictError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  get: {
    path: "/api/v1/EmailTemplate/{id}",
    method: "GET",
    summary: "E-Mail-Vorlage abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
  update: {
    path: "/api/v1/EmailTemplate/{id}",
    method: "PATCH",
    summary: "E-Mail-Vorlage aktualisieren",
    scope: "write",
    request: { body: emailTemplateInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
