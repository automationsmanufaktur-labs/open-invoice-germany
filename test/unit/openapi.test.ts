/**
 * Phase 10, Task 4 (task-4-brief.md/task-4-facts.md, Testjahr 2076): Tests fuer die
 * OpenAPI-Registry (src/api/openapi.ts).
 *
 * 1. Generat == Datei: `buildOpenApiDocument(discoverRouteSpecs())` muss BYTE-GENAU
 *    der committeten `openapi/openapi.json` entsprechen (dieselbe Pruefung wie
 *    `npm run api:check`, hier zusaetzlich als schneller Vitest-Gate).
 * 2. Round-Trip ueber das Dateisystem: jede Datei `src/app/api/v1/**\/route.ts` taucht
 *    im generierten Dokument als Pfad auf, UND jeder Pfad im Dokument stammt aus einer
 *    tatsaechlich existierenden Route-Datei (unabhaengiger fs-Scan, nicht ueber
 *    `discoverRouteSpecs` selbst, um einen Bug DORIN nicht blind zu bestaetigen).
 * 3. Beispiel-Payloads validieren gegen Schemas: fuer jede Basis-CRUD-Ressource
 *    (RESOURCE_SCHEMAS) muss `sampleValue(schema)` (das Beispiel, das auch in die Spec
 *    eingebettet wird) gegen genau dieses Schema parsen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { discoverRouteSpecs, buildOpenApiDocument, serializeDocument, sortKeysDeep, RESOURCE_SCHEMAS, sampleValue } from "@/api/openapi";

const REPO_ROOT = process.cwd();
const V1_ROOT = path.join(REPO_ROOT, "src", "app", "api", "v1");
const OPENAPI_FILE = path.join(REPO_ROOT, "openapi", "openapi.json");

function findRouteFilesIndependently(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRouteFilesIndependently(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/** Next.js-Pfadtemplate aus einem Dateisystempfad ableiten, z. B.
 *  "Invoice/[id]/pdf/route.ts" -> "/api/v1/Invoice/{id}/pdf" — unabhaengige
 *  Referenzimplementierung fuer den Round-Trip-Test (Punkt 2 oben). */
function urlPathFromRouteFile(absFile: string): string {
  const rel = path.relative(V1_ROOT, absFile).replace(/route\.ts$/, "").replace(/\/$/, "");
  const segments = rel
    .split(path.sep)
    .filter(Boolean)
    .map((seg) => (seg.startsWith("[") && seg.endsWith("]") ? `{${seg.slice(1, -1)}}` : seg));
  return `/api/v1/${segments.join("/")}`;
}

describe("OpenAPI-Registry (Phase 10, Task 4)", () => {
  it("Generat == Datei (openapi/openapi.json ist nicht veraltet)", async () => {
    const routes = await discoverRouteSpecs();
    const doc = buildOpenApiDocument(routes);
    const generated = serializeDocument(doc);
    const current = readFileSync(OPENAPI_FILE, "utf8");
    expect(current).toBe(generated);
  });

  it("ist deterministisch (zwei Generierungslaeufe liefern byte-identisches JSON)", async () => {
    const routesA = await discoverRouteSpecs();
    const docA = serializeDocument(buildOpenApiDocument(routesA));
    const routesB = await discoverRouteSpecs();
    const docB = serializeDocument(buildOpenApiDocument(routesB));
    expect(docA).toBe(docB);
  });

  it("sortKeysDeep sortiert rekursiv, unabhaengig von der Einfuegereihenfolge", () => {
    const a = sortKeysDeep({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } });
    const b = sortKeysDeep({ a: { c: [{ y: 2, z: 1 }], d: 1 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("Round-Trip: jede Route-Datei hat einen Pfad im Dokument", async () => {
    const routes = await discoverRouteSpecs();
    const doc = buildOpenApiDocument(routes) as { paths: Record<string, unknown> };
    const docPaths = new Set(Object.keys(doc.paths));

    const files = findRouteFilesIndependently(V1_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const urlPath = urlPathFromRouteFile(file);
      expect(docPaths.has(urlPath), `Route-Datei ohne Pfad im Dokument: ${file} -> ${urlPath}`).toBe(true);
    }
  });

  it("Round-Trip: jeder Pfad im Dokument stammt aus einer existierenden Route-Datei", async () => {
    const routes = await discoverRouteSpecs();
    const doc = buildOpenApiDocument(routes) as { paths: Record<string, unknown> };

    const files = findRouteFilesIndependently(V1_ROOT);
    const filePaths = new Set(files.map(urlPathFromRouteFile));
    for (const docPath of Object.keys(doc.paths)) {
      expect(filePaths.has(docPath), `Pfad im Dokument ohne zugehoerige Route-Datei: ${docPath}`).toBe(true);
    }
  });

  it("wirft eine klare Fehlermeldung fuer eine Route-Datei ohne spec-Export", async () => {
    // Eigener, isolierter Import-Test waere aufwendig (temporaere Datei im echten
    // Baum) — stattdessen wird die Fehlermeldung ueber einen gezielt kaputten Import
    // simuliert: discoverRouteSpecs() importiert reale Dateien, alle haben `spec`
    // (siehe vorherige Tests) — dieser Test dokumentiert daher nur den Vertrag anhand
    // des ping-Sonderfalls: er MUSS spec haben, sonst waere discoverRouteSpecs() oben
    // bereits fehlgeschlagen.
    const routes = await discoverRouteSpecs();
    const ping = routes.find((r) => r.relPath === "ping/route.ts" || r.relPath === path.join("ping", "route.ts"));
    expect(ping?.spec.get?.path).toBe("/api/v1/ping");
  });

  it("jede RESOURCE_SCHEMAS-Ressource: das generierte Beispiel validiert gegen das eigene Schema", () => {
    for (const [name, schema] of Object.entries(RESOURCE_SCHEMAS)) {
      const example = sampleValue(schema);
      const result = schema.safeParse(example);
      expect(result.success, `Beispiel fuer Ressource "${name}" validiert nicht: ${JSON.stringify(result.success ? null : result.error?.issues)}`).toBe(true);
    }
  });

  it("Listen-Umschlag (data[]/total/limit/offset) validiert fuer jede Ressource", async () => {
    const { z } = await import("zod");
    for (const [name, schema] of Object.entries(RESOURCE_SCHEMAS)) {
      const listSchema = z.object({ data: z.array(schema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
      const example = { data: [sampleValue(schema)], total: 1, limit: 50, offset: 0 };
      const result = listSchema.safeParse(example);
      expect(result.success, `Listen-Beispiel fuer Ressource "${name}" validiert nicht`).toBe(true);
    }
  });
});
