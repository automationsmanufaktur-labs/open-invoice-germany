/**
 * GET /api/docs/assets/* — statische swagger-ui-dist-Assets aus node_modules (Phase 10,
 * Task 4, task-4-facts.md: "kein CDN"). Nur eine feste Allowlist an Dateinamen wird
 * ausgeliefert (kein Directory-Traversal moeglich — `..`/verschachtelte Pfade sind
 * gar nicht erst Teil der Allowlist-Schluessel). Auth: Session ODER Bearer wie
 * `/api/docs` selbst (src/api/docs-auth.ts).
 */
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireSessionOrApiKey } from "@/api/docs-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWAGGER_UI_DIST = path.join(process.cwd(), "node_modules", "swagger-ui-dist");

const ALLOWED_FILES: Record<string, string> = {
  "swagger-ui.css": "text/css; charset=utf-8",
  "swagger-ui-bundle.js": "application/javascript; charset=utf-8",
  "swagger-ui-standalone-preset.js": "application/javascript; charset=utf-8",
  "favicon-32x32.png": "image/png",
  "favicon-16x16.png": "image/png",
};

export async function GET(req: Request, ctx: { params: Promise<{ file: string[] }> }): Promise<NextResponse> {
  if (!(await requireSessionOrApiKey(req))) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Session oder API-Schluessel erforderlich." } }, { status: 401 });
  }
  const { file } = await ctx.params;
  const name = file.join("/");
  const contentType = ALLOWED_FILES[name];
  if (!contentType) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Datei nicht gefunden." } }, { status: 404 });
  }
  const bytes = readFileSync(path.join(SWAGGER_UI_DIST, name));
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": contentType, "cache-control": "public, max-age=86400, immutable" },
  });
}
