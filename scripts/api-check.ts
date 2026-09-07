/**
 * npm run api:check — Phase 10, Task 4 (task-4-facts.md): generiert das OpenAPI-3.1-
 * Dokument aus den `spec`-Exporten ALLER /api/v1-Routen (Dateisystem-Scan, siehe
 * src/api/openapi.ts#discoverRouteSpecs) und vergleicht es BYTE-GENAU mit der
 * committeten `openapi/openapi.json`. Exit 1 bei Drift — CI-Gate
 * (.github/workflows/ci.yml, Job `build-test`).
 *
 * Aufruf:
 *   npm run api:check              # nur pruefen (CI)
 *   npm run api:check -- --write   # Datei regenerieren (nach jeder Routen-/Schema-Aenderung)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverRouteSpecs, buildOpenApiDocument, serializeDocument } from "@/api/openapi";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "openapi");
const OUT_FILE = path.join(OUT_DIR, "openapi.json");

async function main() {
  const routes = await discoverRouteSpecs();
  const doc = buildOpenApiDocument(routes);
  const generated = serializeDocument(doc);

  const write = process.argv.includes("--write");
  if (write) {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, generated, "utf8");
    console.log(`openapi/openapi.json geschrieben (${routes.length} Routen-Dateien).`);
    return;
  }

  let current: string | undefined;
  try {
    current = readFileSync(OUT_FILE, "utf8");
  } catch {
    current = undefined;
  }

  if (current === undefined) {
    console.error("openapi/openapi.json fehlt. Einmalig ausfuehren: npm run api:check -- --write");
    process.exit(1);
    return;
  }

  if (current !== generated) {
    console.error("openapi/openapi.json ist veraltet (Drift zwischen Generat und Datei).");
    console.error("Fix: npm run api:check -- --write   (und den Diff committen)");
    process.exit(1);
    return;
  }

  console.log(`openapi/openapi.json ist aktuell und deterministisch (${routes.length} Routen-Dateien).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
