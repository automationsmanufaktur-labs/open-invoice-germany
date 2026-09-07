import { NextResponse } from "next/server";
import { revokeShareLink } from "@/domain/quote-share/link";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

/** Widerruft einen Angebotslink; ab dann liefert die oeffentliche Seite/PDF 404. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const { linkId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    await revokeShareLink(org.id, linkId, { actor });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("DELETE /api/documents/[id]/share-links/[linkId]:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
