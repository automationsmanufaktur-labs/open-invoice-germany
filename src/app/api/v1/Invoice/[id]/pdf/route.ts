/**
 * GET /api/v1/Invoice/{id}/pdf — Rechnung als PDF-Bytes (Content-Type/Content-Disposition,
 * kein `{data}`-JSON-Umschlag). Task 3: nutzt denselben Kern wie das MCP-Tool
 * `get_document_file` (src/api/files.ts#getDocumentFile) — kein zweiter Renderpfad.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { withApi } from "@/api/auth";
import { type RouteSpec } from "@/api/spec";
import { getDocumentFile } from "@/api/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const file = await getDocumentFile(ctx.orgId, "INVOICE", ctx.params.id, "pdf");
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: { "content-type": file.mimeType, "content-disposition": `inline; filename="${file.filenameBase}.pdf"` },
  });
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/Invoice/{id}/pdf",
    method: "GET",
    summary: "Rechnung als PDF herunterladen",
    scope: "read",
    // Bytes statt {data}-Umschlag — Task 4 modelliert den Binaertyp gesondert in OpenAPI.
    response: z.unknown(),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
