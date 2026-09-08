import { withApi } from "@/api/auth";
import { apiList } from "@/api/response";
import { apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeLayout, layoutSchema } from "@/api/serializers/layout";
import { listLayouts } from "@/lib/pdf/layouts/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phase 11b, Task 8 — feste Liste der sieben PDF-Layouts (keine Paginierung, keine DB-Tabelle). */
export const GET = withApi(async () => {
  const rows = listLayouts().map(serializeLayout);
  return apiList(rows, { total: rows.length, limit: rows.length, offset: 0 });
}, { scope: "read" });

export const spec = {
  list: {
    path: "/api/v1/Layout",
    // Fix-Welle (Abschluss-Review, Block 1 "Minor"): `layoutSchema` statt `z.unknown()` —
    // war nur deshalb bereits korrekt in openapi.json, weil `RESOURCE_SCHEMAS.Layout` +
    // `baseResourceName()` es namentlich ueberschreiben; mit dem echten Schema hier ist die
    // Route selbstdokumentierend.
    method: "GET",
    summary: "PDF-Layouts auflisten (feste Liste, keine Paginierung — `limit`/`offset` werden ignoriert, alle sieben Layouts kommen immer zurueck)",
    scope: "read",
    response: apiListResponseSchema(layoutSchema),
    errors: [401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
