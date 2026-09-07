import { NextResponse } from "next/server";
import { z } from "zod";
import { createPartialInvoiceSchema } from "@/schemas";
import { createPartialInvoice, PartialInvoiceError } from "@/domain/invoice/partial";
import { PricingError } from "@/lib/pricing/errors";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

/** Task 4: Teilrechnung (§13 UStG) aus einem Lieferschein. sourceType/sourceId kommen
 *  aus der URL (immer DELIVERY_NOTE) — analog /api/documents/[id]/partial-invoice. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";

    let raw: unknown = {};
    const text = await req.text();
    if (text.trim() !== "") raw = JSON.parse(text);
    const body = createPartialInvoiceSchema.parse({ ...(typeof raw === "object" && raw !== null ? raw : {}), sourceType: "DELIVERY_NOTE", sourceId: id });

    const invoice = await createPartialInvoice(org.id, body, { actor });
    return NextResponse.json({ id: invoice.id, status: invoice.status, type: invoice.type }, { status: 201 });
  } catch (e) {
    // Nit (Fix-Welle): siehe /api/documents/[id]/partial-invoice/route.ts.
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungueltiges JSON im Request-Body" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof PartialInvoiceError || e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/delivery-notes/[id]/partial-invoice:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
