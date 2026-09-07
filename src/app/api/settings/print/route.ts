import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { loadPrintSettings, savePrintSettings } from "@/domain/settings/print";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const org = await getActiveOrg();
  const settings = await loadPrintSettings(org.id);
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const settings = await savePrintSettings(org.id, body);
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("PUT /api/settings/print:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
