/**
 * GET /api/v1/openapi.json — das OpenAPI-3.1-Dokument (Phase 10, Task 4,
 * task-4-brief.md). Liefert die COMMITTETE Datei `openapi/openapi.json` unveraendert —
 * kein dynamisches Neu-Generieren zur Laufzeit (Determinismus/Drift-Pruefung laeuft
 * ausschliesslich ueber `npm run api:check`, siehe scripts/api-check.ts und
 * src/api/openapi.ts; ein fs-Scan aller Routen-Dateien im Next.js-Serverless-Bundle
 * waere fragil und unnoetig, da die Datei ohnehin bei jeder Aenderung committet wird).
 *
 * Auth: Session ODER Bearer (src/api/docs-auth.ts) — Swagger UI (`/api/docs`) laedt
 * diese Datei per Browser-Session, waehrend externe Werkzeuge einen API-Schluessel
 * nutzen. Deshalb KEIN `withApi` (erzwingt ausschliesslich Bearer).
 */
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { requireSessionOrApiKey } from "@/api/docs-auth";
import { type RouteSpec } from "@/api/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAPI_FILE = path.join(process.cwd(), "openapi", "openapi.json");

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await requireSessionOrApiKey(req))) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Session oder API-Schluessel erforderlich." } }, { status: 401 });
  }
  const json = readFileSync(OPENAPI_FILE, "utf8");
  return new NextResponse(json, { headers: { "content-type": "application/json; charset=utf-8" } });
}

// Phase 10, Task 4 (task-4-facts.md Round-Trip-Test): auch diese Meta-Route braucht
// einen `spec`-Export. `scope: "read"` ist rein dokumentarisch — tatsaechlich
// durchgesetzt wird Session-ODER-Bearer (siehe oben), nicht `withApi`/Scopes.
export const spec = {
  get: {
    path: "/api/v1/openapi.json",
    method: "GET",
    summary: "OpenAPI-3.1-Dokument abrufen (Session oder API-Schluessel, kein Scope-Zwang)",
    scope: "read",
    response: z.unknown(),
    errors: [401],
  },
} satisfies Record<string, RouteSpec>;
