import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { loadBrandingSettings, saveBrandingSettings } from "@/domain/settings/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH_FIELDS = ["logoPath", "backgroundPath", "faviconPath", "appLogoPath"] as const;

export async function GET() {
  const org = await getActiveOrg();
  const settings = await loadBrandingSettings(org.id);
  return NextResponse.json({ settings });
}

/**
 * Fix-Welle (Fix 1): logoPath/backgroundPath/faviconPath/appLogoPath sind NIE per PUT
 * client-schreibbar — dieselbe Regel wie update_branding_settings (MCP) und
 * PATCH /api/v1/Settings. Ein mitgeschickter Wert wird ignoriert, der aktuell
 * gespeicherte Pfad bleibt bestehen; nur die Upload-Route
 * (POST /api/settings/branding/upload) setzt sie. Das Formular (BrandingForm.tsx,
 * LayoutGallery.tsx) sendet ohnehin immer den zuletzt geladenen Stand zurueck, dieses
 * Verhalten ist fuer den regulaeren UI-Fluss also unsichtbar.
 */
export async function PUT(req: Request) {
  try {
    const org = await getActiveOrg();
    const body: unknown = await req.json();
    const current = await loadBrandingSettings(org.id);
    const rawBody = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
    for (const field of PATH_FIELDS) delete rawBody[field];
    const settings = await saveBrandingSettings(org.id, {
      ...rawBody,
      logoPath: current.logoPath,
      backgroundPath: current.backgroundPath,
      faviconPath: current.faviconPath,
      appLogoPath: current.appLogoPath,
    });
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("PUT /api/settings/branding:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
