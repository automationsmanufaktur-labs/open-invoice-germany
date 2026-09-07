import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { setDunningState } from "@/domain/dunning/state";
import { DunningError } from "@/domain/dunning/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const body = await req.json();
    const result = await setDunningState(org.id, id, body, actor);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof DunningError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/invoices/[id]/dunning-state:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
