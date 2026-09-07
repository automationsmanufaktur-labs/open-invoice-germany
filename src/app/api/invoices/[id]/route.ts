import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { updateDraftInvoice, InvoiceUpdateError } from "@/domain/invoice/update";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";

/**
 * Bearbeitet einen Rechnungsentwurf (Phase 4b, nur DRAFT — GoBD, Lastenheft 51).
 * Analog PATCH /api/documents/[id].
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const body = await req.json();
    const updated = await updateDraftInvoice(org.id, id, body, actor);
    return NextResponse.json({ id: updated.id, number: updated.number, status: updated.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof InvoiceUpdateError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("PATCH /api/invoices/[id]:", e);
    return NextResponse.json({ error: "Aktualisieren fehlgeschlagen." }, { status: 500 });
  }
}
