/**
 * Demo-Route fuer den withApi-Wrapper (Phase 10, Task 1) — kein eigenes Fach-Feature,
 * dient nur dem End-zu-End-Test des Wrappers (Auth/Scope/Rate-Limit/Fehlerformat).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, ctx) => {
  return apiData({ pong: true, orgId: ctx.orgId, keyName: ctx.apiKey.name });
}, { scope: "read" });

// Phase 10, Task 4 (task-4-facts.md Round-Trip-Test): jede Route-Datei unter
// src/app/api/v1 braucht einen `spec`-Export, auch diese Demo-Route.
export const spec = {
  get: {
    path: "/api/v1/ping",
    method: "GET",
    summary: "Erreichbarkeits-/Auth-Test (Demo-Route, kein Fachfeature)",
    scope: "read",
    response: apiDataResponseSchema(z.object({ pong: z.boolean(), orgId: z.string(), keyName: z.string() })),
    errors: [401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
