import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { listTextTemplatesApi } from "@/domain/text-template/list";

export const runtime = "nodejs";

/**
 * Session-Route (Phase 11c, Task 3) fuer `TextTemplatePicker` im Beleg-Editor — anders
 * als `/api/v1/TextTemplate` (API-Key-Auth via `withApi`, fuer externe Integrationen)
 * nutzt diese Route die Browser-Session wie `/api/text-templates/pick`, ruft aber
 * dieselbe Domain-Listenfunktion (`listTextTemplatesApi`) auf, die auch die v1-API
 * verwendet — keine zweite Query-/Filter-Implementierung.
 */
export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const result = await listTextTemplatesApi(org.id, Object.fromEntries(searchParams));
    return NextResponse.json({
      templates: result.rows.map((t) => ({ id: t.id, name: t.name, body: t.body, isDefault: t.isDefault })),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/text-templates:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
