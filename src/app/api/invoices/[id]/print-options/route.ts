import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { setPrintOptions } from "@/domain/settings/print";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setzt die Druckoptionen-Ueberschreibung einer Rechnung — nur im Entwurf (DRAFT). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const override = await setPrintOptions(org.id, { kind: "INVOICE", id }, body);
    return NextResponse.json({ printOptions: override });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof InvalidOperationError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("PUT /api/invoices/[id]/print-options:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
