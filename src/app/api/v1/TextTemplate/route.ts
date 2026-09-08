import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeTextTemplate } from "@/api/serializers/text-template";
import { listTextTemplatesApi, textTemplateListFilterSchema } from "@/domain/text-template/list";
import { saveTextTemplate, TemplateNameConflictError } from "@/domain/text-template/manage";
import { textTemplateInputSchema } from "@/schemas";
import { InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listTextTemplatesApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeTextTemplate), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  try {
    const created = await saveTextTemplate(ctx.orgId, { ...(ctx.body as object), id: undefined });
    return apiData(serializeTextTemplate(created), 201);
  } catch (e) {
    if (e instanceof TemplateNameConflictError) throw new InvalidOperationError(e.message);
    throw e;
  }
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/TextTemplate",
    method: "GET",
    summary: "Textvorlagen auflisten",
    scope: "read",
    request: { query: textTemplateListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/TextTemplate",
    method: "POST",
    summary: "Textvorlage anlegen",
    scope: "write",
    request: { body: textTemplateInputSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
