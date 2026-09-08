import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { searchQuerySchema } from "@/schemas/search";
import { globalSearch } from "@/domain/search/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phase 11a: `GET /api/search?q=&limit=` — globale Suche fuer die Befehlspalette. */
export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const parsed = searchQuerySchema.safeParse({
      q: searchParams.get("q") ?? "",
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültige Suchanfrage", details: parsed.error.flatten() }, { status: 400 });
    }
    const result = await globalSearch(org.id, parsed.data);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("GET /api/search:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
