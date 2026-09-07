import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { updateDunningStage, deleteDunningStage, DunningStageError } from "@/domain/dunning/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapError(e: unknown, routeLabel: string) {
  if (e instanceof z.ZodError) {
    return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
  }
  if (e instanceof DunningStageError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error(routeLabel, e);
  return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const stage = await updateDunningStage(org.id, id, body);
    return NextResponse.json({ stage });
  } catch (e) {
    return mapError(e, "PATCH /api/dunning-stages/[id]:");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    await deleteDunningStage(org.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e, "DELETE /api/dunning-stages/[id]:");
  }
}
