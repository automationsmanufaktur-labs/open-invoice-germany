/**
 * Fix-Welle Phase 10 (Nit 12, final-review-findings.md): `discoverRouteSpecs`
 * (src/api/openapi.ts) verlangt bisher nur einen `spec`-Export je Route-Datei — nichts
 * erzwingt, dass der tatsaechliche Handler auch WIRKLICH per `withApi` (src/api/auth.ts)
 * laeuft. Da der gesamte `/api/v1`-Praefix proxy-oeffentlich ist (src/proxy.ts, Auth
 * ausschliesslich im withApi-Wrapper), waere eine vergessene Umhuellung ein voellig
 * ungeschuetzter Endpunkt. Dieser Test importiert JEDE Route-Datei unter src/app/api/v1
 * (unabhaengiger fs-Scan, nicht ueber discoverRouteSpecs) und prueft fuer jede
 * exportierte GET/POST/PATCH/PUT/DELETE-Funktion das Marker-Symbol, das `withApi`
 * (WITH_API_MARKER) an ihrem Rueckgabewert setzt.
 *
 * Einzige bekannte, bewusste Ausnahme: `openapi.json/route.ts` (Session-ODER-Bearer,
 * siehe dessen Modulkommentar) — dort greift `requireSessionOrApiKey` statt `withApi`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { WITH_API_MARKER } from "@/api/auth";

const V1_ROOT = path.resolve(process.cwd(), "src/app/api/v1");
const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

// Bewusste Ausnahme (siehe Modulkommentar oben) — relativ zu V1_ROOT, POSIX-Separatoren.
const EXEMPT_RELPATHS = new Set(["openapi.json/route.ts"]);

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRouteFiles(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("jede /api/v1-Route ist ein withApi-Produkt (Nit 12)", () => {
  const files = findRouteFiles(V1_ROOT);

  it("findet ueberhaupt Route-Dateien (Test waere sonst stillschweigend wirkungslos)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relPath = path.relative(V1_ROOT, file).split(path.sep).join("/");
    if (EXEMPT_RELPATHS.has(relPath)) continue;

    it(`${relPath}: jede exportierte HTTP-Methode traegt WITH_API_MARKER`, async () => {
      const mod = (await import(file)) as Record<string, unknown>;
      const exportedMethods = HTTP_METHODS.filter((m) => typeof mod[m] === "function");
      expect(exportedMethods.length, `${relPath} exportiert keine HTTP-Methode`).toBeGreaterThan(0);
      for (const method of exportedMethods) {
        const fn = mod[method] as unknown as Record<symbol, unknown>;
        expect(fn[WITH_API_MARKER], `${relPath}#${method} ist kein withApi-Produkt`).toBe(true);
      }
    });
  }
});
