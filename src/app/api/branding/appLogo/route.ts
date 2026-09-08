import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { readFile, sniffMime } from "@/lib/attachments/storage";
import { ASSET_CACHE_HEADERS, assetEtag, isWithinAttachmentsRoot } from "../asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Kein Logo hinterlegt." }, { status: 404 });
}

/**
 * App-Logo der Instanz (Phase 12c; Fix-Welle Fix 1: Containment-Pruefung, ETag) —
 * OEFFENTLICH (in PUBLIC_PREFIXES): die schlanke Login-/Setup-Huelle zeigt es bereits
 * vor jeder Session. Anders als /api/branding/icon KEIN Fallback: ohne Upload ODER bei
 * einem Pfad ausserhalb von ATTACHMENTS_DIR (isWithinAttachmentsRoot, asset.ts,
 * Verteidigung in der Tiefe) ODER wenn sich die Bytes nicht als PNG/JPEG sniffen lassen
 * -> 404, die Huelle zeigt dann stattdessen das App-Kuerzel (appShortName) als Text.
 * Der gespeicherte Pfad traegt keinen Dateityp, deshalb kommt der Content-Type ueber
 * sniffMime aus dem Puffer (nur PNG/JPEG — dieselbe Beschraenkung wie beim Upload).
 *
 * `?v=<updatedAt>` (von der Huelle, Task 3, an das <img> angehaengt) ist reines
 * Cache-Busting fuer den Browser — diese Route liest den Parameter nicht, sondern setzt
 * auf ETag + `must-revalidate`.
 */
export async function GET() {
  try {
    const org = await getActiveOrg();
    const row = await dbInternal.brandingSettings.findUnique({
      where: { orgId: org.id },
      select: { appLogoPath: true, updatedAt: true },
    });
    if (!row?.appLogoPath || !isWithinAttachmentsRoot(row.appLogoPath)) return notFound();
    const buffer = await readFile(row.appLogoPath);
    const mime = sniffMime(buffer);
    if (mime !== "image/png" && mime !== "image/jpeg") return notFound();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { "content-type": mime, etag: assetEtag(row.updatedAt, row.appLogoPath), ...ASSET_CACHE_HEADERS },
    });
  } catch {
    return notFound();
  }
}
