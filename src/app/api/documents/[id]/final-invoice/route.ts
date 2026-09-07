import { NextResponse } from "next/server";
import { z } from "zod";
import { createFinalInvoiceSchema } from "@/schemas";
import { createFinalInvoice, FinalInvoiceError } from "@/domain/invoice/final";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

/** Task 4: Schlussrechnung (§14 Abs. 5 UStG) — kein Body noetig, sourceType/sourceId
 *  ergeben sich aus der URL (immer QUOTE). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";

    const body = createFinalInvoiceSchema.parse({ sourceType: "QUOTE", sourceId: id });
    const invoice = await createFinalInvoice(org.id, body, { actor });
    return NextResponse.json({ id: invoice.id, status: invoice.status, type: invoice.type }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof FinalInvoiceError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/documents/[id]/final-invoice:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
