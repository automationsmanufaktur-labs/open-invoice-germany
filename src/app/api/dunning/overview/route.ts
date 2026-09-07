import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { loadDunningOverview } from "@/domain/dunning/overview";
import { dunningOverviewFilterSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const raw: Record<string, string> = {};
    for (const key of ["customerId", "state", "stageOrder"]) {
      const v = searchParams.get(key);
      if (v !== null && v !== "") raw[key] = v;
    }
    const filter = dunningOverviewFilterSchema.parse(raw);
    const overview = await loadDunningOverview(org.id, new Date(), filter);
    return NextResponse.json(overview);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/dunning/overview:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
