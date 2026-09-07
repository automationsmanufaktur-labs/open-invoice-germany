/**
 * Fix-Welle Phase 10 (Blocking 3): `src/app/api/v1/openapi.json/route.ts` liest
 * `openapi/openapi.json` relativ zu `process.cwd()` zur Laufzeit — die runner-Stage des
 * Dockerfiles muss dieses Verzeichnis daher explizit kopieren, sonst 500 auf `/api/docs`
 * und `GET /api/v1/openapi.json` auf jeder Produktivinstanz (final-review-findings.md #3).
 * Dieser Test schuetzt gegen ein versehentliches Entfernen der COPY-Zeile in einer
 * kuenftigen Aenderung des Dockerfiles — die volle Verifikation (`docker build` + `ls
 * openapi` im Container) laeuft separat, siehe fix-wave-report.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Dockerfile", () => {
  it("kopiert openapi/ in die runner-Stage (sonst 500 auf /api/docs)", () => {
    const dockerfile = readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    const runnerStage = dockerfile.slice(dockerfile.indexOf("AS runner"));
    expect(runnerStage).toMatch(/COPY --from=build \/app\/openapi \.\/openapi/);
  });
});
