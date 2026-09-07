import { NextResponse } from "next/server";
import { duplicateDocument } from "@/domain/document/duplicate";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const copy = await duplicateDocument(org.id, "INVOICE", id, actor);
    return NextResponse.json(copy, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    // Fix-Runde 1 (MEDIUM): PARTIAL/DOWNPAYMENT/FINAL koennen nicht dupliziert werden —
    // dedizierte Fehlerklasse statt generischem Error, gemappt auf 409 Conflict.
    if (e instanceof InvalidOperationError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /duplicate:", e);
    return NextResponse.json({ error: "Duplizieren fehlgeschlagen." }, { status: 500 });
  }
}
