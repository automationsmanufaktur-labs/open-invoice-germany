import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { reorderDunningStages, DunningStageError } from "@/domain/dunning/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    await reorderDunningStages(org.id, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof DunningStageError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("POST /api/dunning-stages/reorder:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
