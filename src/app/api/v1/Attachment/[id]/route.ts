import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeAttachment } from "@/api/serializers/attachment";
import { findAttachmentApi } from "@/domain/attachment/list";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const row = await findAttachmentApi(ctx.orgId, ctx.params.id);
  if (!row) throw new NotFoundError("Anhang nicht gefunden.");
  return apiData(serializeAttachment(row));
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/Attachment/{id}",
    method: "GET",
    summary: "Beleganhang-Metadaten abrufen",
    scope: "read",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
