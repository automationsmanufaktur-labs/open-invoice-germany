/**
 * GET /api/v1/Invoice/{id}/xrechnung — Rechnung als XRechnung-UBL-XML (nur festgeschrieben).
 * Task 3: nutzt src/api/files.ts#getDocumentFile (derselbe Kern wie das MCP-Tool
 * `get_document_file`) — bewusst OHNE die EN-16931-Validierung/Benachrichtigung der
 * Session-Route `/api/invoices/[id]/xrechnung` (siehe Modulkommentar in src/api/files.ts).
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { withApi } from "@/api/auth";
import { type RouteSpec } from "@/api/spec";
import { getDocumentFile } from "@/api/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const file = await getDocumentFile(ctx.orgId, "INVOICE", ctx.params.id, "xrechnung");
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: { "content-type": file.mimeType, "content-disposition": `attachment; filename="${file.filenameBase}.xml"` },
  });
}, { scope: "read" });

export const spec = {
  get: {
    path: "/api/v1/Invoice/{id}/xrechnung",
    method: "GET",
    summary: "Rechnung als XRechnung-XML herunterladen (nur festgeschrieben)",
    scope: "read",
    response: z.unknown(),
    errors: [401, 403, 404, 409, 429],
  },
} satisfies Record<string, RouteSpec>;
