import { NextResponse } from "next/server";
import { z } from "zod";
import { createDownpaymentInvoiceSchema } from "@/schemas";
import { createDownpaymentInvoice, DownpaymentInvoiceError } from "@/domain/invoice/downpayment";
import { PricingError } from "@/lib/pricing/errors";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

/** Task 4: Abschlagsrechnung (§13/§14 Abs. 5 UStG) — sourceType/sourceId aus der URL
 *  (immer QUOTE), Body traegt nur mode/permille/amountCents/amountIsGross. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";

    let raw: unknown = {};
    const text = await req.text();
    if (text.trim() !== "") raw = JSON.parse(text);
    const body = createDownpaymentInvoiceSchema.parse({ ...(typeof raw === "object" && raw !== null ? raw : {}), sourceType: "QUOTE", sourceId: id });

    const invoice = await createDownpaymentInvoice(org.id, body, { actor });
    return NextResponse.json({ id: invoice.id, status: invoice.status, type: invoice.type }, { status: 201 });
  } catch (e) {
    // Nit (Fix-Welle): siehe partial-invoice/route.ts.
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungueltiges JSON im Request-Body" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof DownpaymentInvoiceError || e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/documents/[id]/downpayment-invoice:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
