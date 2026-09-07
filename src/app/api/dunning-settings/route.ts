import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { loadDunningSettings, saveDunningSettings } from "@/domain/dunning/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const org = await getActiveOrg();
  const settings = await loadDunningSettings(org.id);
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const settings = await saveDunningSettings(org.id, body);
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("PUT /api/dunning-settings:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
