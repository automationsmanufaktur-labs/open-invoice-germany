/**
 * GET /api/docs — Swagger-UI-Seite (Phase 10, Task 4, task-4-facts.md: "swagger-ui-dist
 * aus node_modules statisch ausliefern ... kein CDN"). Eigene, schlanke HTML-Seite
 * (NICHT swagger-ui-dist/index.html, das per Default gegen die Petstore-Demo zeigt) —
 * initialisiert `SwaggerUIBundle` gegen `/api/v1/openapi.json`, Assets kommen von
 * `/api/docs/assets/*` (src/app/api/docs/assets/[...file]/route.ts).
 *
 * Auth: Session ODER Bearer (src/api/docs-auth.ts). `/api/docs` steht deshalb in
 * `PUBLIC_PREFIXES` (src/proxy.ts) — die eigentliche Pruefung passiert HIER, nicht im
 * Proxy (der wuerde sonst ausschliesslich Session kennen und externe Bearer-Clients
 * aussperren, bevor die Route ueberhaupt erreicht wird).
 */
import { NextResponse } from "next/server";
import { requireSessionOrApiKey } from "@/api/docs-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>OpenInvoice Germany — API-Dokumentation</title>
<link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
<link rel="icon" href="/api/docs/assets/favicon-32x32.png" sizes="32x32" />
<style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="/api/docs/assets/swagger-ui-bundle.js"></script>
<script src="/api/docs/assets/swagger-ui-standalone-preset.js"></script>
<script>
  window.onload = function () {
    window.ui = SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
      docExpansion: "list",
      persistAuthorization: true,
    });
  };
</script>
</body>
</html>
`;

export async function GET(req: Request): Promise<NextResponse> {
  if (await requireSessionOrApiKey(req)) {
    return new NextResponse(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  // Ein Client, der bereits einen (ungueltigen) Bearer-Token mitschickt, ist kein
  // Browser ohne Session — dann 401 statt eines Redirects auf /login.
  if (req.headers.get("authorization")) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Session oder API-Schluessel erforderlich." } }, { status: 401 });
  }
  const url = new URL(req.url);
  url.pathname = "/login";
  url.searchParams.set("from", "/api/docs");
  return NextResponse.redirect(url);
}
