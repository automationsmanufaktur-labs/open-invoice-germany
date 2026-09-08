import { NextResponse } from "next/server";
import { remainingQuantities } from "@/domain/delivery-note/quantities";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const remaining = await remainingQuantities(org.id, "QUOTE", id);
    return NextResponse.json(remaining);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("GET /api/documents/[id]/remaining:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
