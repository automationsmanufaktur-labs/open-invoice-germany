import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeEmailTemplate } from "@/api/serializers/email-template";
import { listEmailTemplatesApi, emailTemplateListFilterSchema } from "@/domain/email/template-list";
import { saveEmailTemplate, TemplateNameConflictError } from "@/domain/email/templates";
import { emailTemplateInputSchema } from "@/schemas";
import { InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listEmailTemplatesApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeEmailTemplate), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const input = emailTemplateInputSchema.parse({ ...(ctx.body as object), id: undefined });
  try {
    const created = await saveEmailTemplate(ctx.orgId, input);
    return apiData(serializeEmailTemplate(created), 201);
  } catch (e) {
    if (e instanceof TemplateNameConflictError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/EmailTemplate",
    method: "GET",
    summary: "E-Mail-Vorlagen auflisten",
    scope: "read",
    request: { query: emailTemplateListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/EmailTemplate",
    method: "POST",
    summary: "E-Mail-Vorlage anlegen",
    scope: "write",
    request: { body: emailTemplateInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
