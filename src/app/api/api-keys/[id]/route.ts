import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { revokeApiKey } from "@/domain/api-key/revoke";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    await revokeApiKey(org.id, id, "session");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("DELETE /api/api-keys/[id]:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
