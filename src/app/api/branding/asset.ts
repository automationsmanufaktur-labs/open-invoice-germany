/**
 * Gemeinsame Bausteine der beiden oeffentlichen Marken-Auslieferungsrouten
 * (icon/route.ts, appLogo/route.ts) — Fix-Welle 12c Fix 1:
 *  - Pfad-Containment-Pruefung (Verteidigung in der Tiefe: die Upload-Route ist der
 *    EINZIGE Weg, wie ein storagePath in BrandingSettings landet, und die drei
 *    Schreibpfade — PUT /api/settings/branding, PATCH /api/v1/Settings,
 *    MCP update_branding_settings — lehnen faviconPath/appLogoPath aus dem Request-Body
 *    jetzt ab; dieser Check ist die zweite Schicht, falls ein Pfad je auf einem anderen
 *    Weg — Migration, direkter DB-Zugriff — dorthin gelangt).
 *  - ETag aus updatedAt+Pfad, damit Browser/CDN einen Re-Upload sofort erkennen.
 *
 * Kein Import aus src/lib/attachments/storage.ts noetig/gewuenscht: `attachmentsRoot()`
 * ist dort bewusst NICHT exportiert (interne Implementierungsdetails), daher hier
 * dieselbe ATTACHMENTS_DIR-Aufloesung dupliziert statt den Export dort aufzuweichen.
 */
import path from "node:path";
import { createHash } from "node:crypto";

export const ASSET_CACHE_HEADERS = {
  "cache-control": "public, max-age=300, must-revalidate",
  "x-content-type-options": "nosniff",
} as const;

function attachmentsRoot(): string {
  const dir = process.env.ATTACHMENTS_DIR || "./data/attachments";
  return path.isAbsolute(dir) ? path.resolve(dir) : path.resolve(process.cwd(), dir);
}

/** true, wenn `storagePath` (ein relativer Pfad aus BrandingSettings) nach der
 *  Aufloesung wirklich INNERHALB von ATTACHMENTS_DIR liegt — blockt "../../etc/passwd"-
 *  artige Werte, BEVOR readFile() (storage.ts) sie liest. */
export function isWithinAttachmentsRoot(storagePath: string): boolean {
  const root = attachmentsRoot();
  const resolved = path.resolve(root, ...storagePath.split("/"));
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Kurzer, stabiler ETag aus updatedAt (BrandingSettings-Zeile) + Pfad — aendert sich
 *  bei jedem Re-Upload (neuer storagePath UND neues updatedAt), bleibt sonst stabil. */
export function assetEtag(updatedAt: Date, storagePath: string): string {
  return `"${createHash("sha256").update(`${updatedAt.toISOString()}:${storagePath}`).digest("hex").slice(0, 32)}"`;
}
