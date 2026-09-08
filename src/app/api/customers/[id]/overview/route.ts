import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { customerOverview } from "@/domain/customer/overview";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const overview = await customerOverview(org.id, id, new Date());
    return NextResponse.json(overview);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("GET /api/customers/[id]/overview:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
