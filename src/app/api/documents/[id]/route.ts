import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { updateDraftDocument } from "@/domain/document/update";
import { StatusTransitionError } from "@/domain/document/status";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const body = await req.json();
    const updated = await updateDraftDocument(org.id, id, body, actor);
    return NextResponse.json({ id: updated.id, number: updated.number, status: updated.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof StatusTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("PATCH /api/documents/[id]:", e);
    return NextResponse.json({ error: "Aktualisieren fehlgeschlagen." }, { status: 500 });
  }
}
