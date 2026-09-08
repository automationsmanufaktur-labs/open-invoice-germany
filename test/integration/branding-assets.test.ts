/**
 * Phase 12c, Task 2 — Upload-Validierung (favicon/applogo) und die beiden OEFFENTLICHEN
 * Auslieferungsrouten. Eigenes Jahr 2079 (Testjahr-Konvention) — kein Rechnungsbezug.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { dbInternal } from "@/lib/db";
import { testPngBuffer } from "../helpers/pdf-theme";
import { POST } from "@/app/api/settings/branding/upload/route";
import { GET as iconGet } from "@/app/api/branding/icon/route";
import { GET as logoGet } from "@/app/api/branding/appLogo/route";
import { PUBLIC_PREFIXES } from "@/proxy";

let orgId: string;
vi.mock("@/lib/org", () => ({ getActiveOrg: () => Promise.resolve({ id: orgId }) }));

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Marke Test GmbH", addressLine1: "Markenweg 1", postalCode: "10115", city: "Berlin" },
  });
  orgId = org.id;
});

function upload(kind: string, buf: Buffer, name: string, mime: string) {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(buf)], name, { type: mime }));
  // FormData-Bodies liefern in dieser Umgebung keinen automatischen content-length-Header
  // (siehe settings-routes.test.ts) — die Route braucht ihn fuer die Vorpruefung.
  return new Request(`http://x/api/settings/branding/upload?kind=${kind}`, { method: "POST", body: fd, headers: { "content-length": "100" } });
}

describe("Branding-Upload: favicon/applogo", () => {
  it("quadratisches 64x64-PNG als Favicon -> 201 und Pfad gespeichert", async () => {
    expect((await POST(upload("favicon", testPngBuffer(64, 64), "icon.png", "image/png"))).status).toBe(201);
    expect((await dbInternal.brandingSettings.findUnique({ where: { orgId } }))?.faviconPath).toBeTruthy();
  });

  it("weist nicht quadratische, zu kleine, JPEG- und unbekannt-kind-Uploads mit 400 ab", async () => {
    const cases: [string, Buffer, string, string][] = [
      ["favicon", testPngBuffer(100, 200), "icon.png", "image/png"], // nicht quadratisch
      ["favicon", testPngBuffer(16, 16), "icon.png", "image/png"], // < 32 px
      ["favicon", testPngBuffer(64, 64), "icon.jpg", "image/jpeg"], // Favicon nur PNG
      ["banner", testPngBuffer(64, 64), "x.png", "image/png"], // unbekanntes kind
    ];
    for (const [kind, buf, name, mime] of cases) {
      expect((await POST(upload(kind, buf, name, mime))).status).toBe(400);
    }
  });
});

describe("Oeffentliche Auslieferung", () => {
  it("GET /api/branding/icon liefert das hochgeladene Favicon mit Cache-Header und ETag", async () => {
    const res = await iconGet(new Request("http://x/api/branding/icon"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    expect(res.headers.get("cache-control")).toContain("must-revalidate");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("GET /api/branding/appLogo ohne Upload -> 404 (Huelle zeigt dann das Kuerzel)", async () => {
    await dbInternal.brandingSettings.update({ where: { orgId }, data: { appLogoPath: null } });
    expect((await logoGet()).status).toBe(404);
  });

  it("/api/branding ist proxy-oeffentlich", () => {
    expect(PUBLIC_PREFIXES).toContain("/api/branding");
  });
});

describe("Pfad-Containment (Fix-Welle Fix 1 — Verteidigung in der Tiefe)", () => {
  // Ueber die drei Schreibpfade (PUT, PATCH, MCP) ist ein solcher Wert seit Fix 1 nicht
  // mehr erreichbar — dieser Test schreibt ihn deshalb DIREKT in die DB, um zu pruefen,
  // dass die Ausliefer-Routen selbst bei einem manipulierten storagePath niemals eine
  // Datei ausserhalb von ATTACHMENTS_DIR lesen.
  const TRAVERSAL = "../../../../../../etc/passwd";

  it("faviconPath mit Pfad-Traversal -> Fallback-Icon, KEIN Dateizugriff ausserhalb ATTACHMENTS_DIR", async () => {
    await dbInternal.brandingSettings.update({ where: { orgId }, data: { faviconPath: TRAVERSAL } });
    const res = await iconGet(new Request("http://x/api/branding/icon"));
    expect(res.status).toBe(200);
    // "image/x-icon" ist der Fallback-Typ (mitgeliefertes favicon.ico) — ein Treffer
    // beweist, dass die Route den traversierten Pfad verworfen und NICHT gelesen hat.
    expect(res.headers.get("content-type")).toBe("image/x-icon");
  });

  it("appLogoPath mit Pfad-Traversal -> 404, KEIN Dateizugriff ausserhalb ATTACHMENTS_DIR", async () => {
    await dbInternal.brandingSettings.update({ where: { orgId }, data: { appLogoPath: TRAVERSAL } });
    const res = await logoGet();
    expect(res.status).toBe(404);
  });
});
