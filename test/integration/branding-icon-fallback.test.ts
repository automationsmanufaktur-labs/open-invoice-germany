/**
 * Fix-Welle 12c, C1 — Regression fuer die Produktionsluecke: in der runner-Stage des
 * Docker-Images fehlte `src/app/favicon.ico` (nur `src/generated` wurde kopiert), sodass
 * der Bundle-Fallback-Read in GET /api/branding/icon ein unbehandeltes ENOENT warf ->
 * 500 auf JEDER Seite ohne eigenes hochgeladenes Favicon (generateMetadata haengt die
 * Route ueberall an, inkl. Login). Lokale Gates sehen das nicht (cwd = Repo-Wurzel, die
 * Datei existiert dort), deshalb wird der fehlende Fallback hier erzwungen: keine
 * Organisation (Primaerpfad scheitert sofort) UND `node:fs/promises`.`readFile` schlaegt
 * fehl (simuliert den fehlenden Bundle-Fallback). Erwartung nach dem Fix: niemals 500,
 * sondern eine 302-Umleitung auf die statische Next-Route `/favicon.ico`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/org", () => ({
  getActiveOrg: () => Promise.reject(new Error("keine aktive Organisation (Test)")),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: () => Promise.reject(Object.assign(new Error("ENOENT: kein favicon.ico im Image (Test)"), { code: "ENOENT" })),
  };
});

import { GET as iconGet } from "@/app/api/branding/icon/route";

describe("GET /api/branding/icon — Bundle-Fallback fehlt (C1)", () => {
  it("wirft KEIN 500, sondern leitet auf /favicon.ico um, wenn weder DB-Icon noch Bundle-Fallback lesbar sind", async () => {
    const res = await iconGet(new Request("http://x/api/branding/icon"));
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/favicon.ico");
  });
});
