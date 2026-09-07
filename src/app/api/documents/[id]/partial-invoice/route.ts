import { NextResponse } from "next/server";
import { z } from "zod";
import { createPartialInvoiceSchema } from "@/schemas";
import { createPartialInvoice, PartialInvoiceError } from "@/domain/invoice/partial";
import { PricingError } from "@/lib/pricing/errors";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Task 4: Teilrechnung (§13 UStG) aus einem Angebot/einer Auftragsbestaetigung.
 * sourceType/sourceId kommen aus der URL (immer QUOTE) — der Body traegt nur die
 * Modus-Felder (mode/permille/amountCents/lineIds/quantities), analog dem Muster von
 * POST /api/documents/[id]/convert (fromType/fromId aus der URL, nicht aus dem Body).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";

    let raw: unknown = {};
    const text = await req.text();
    if (text.trim() !== "") raw = JSON.parse(text);
    const body = createPartialInvoiceSchema.parse({ ...(typeof raw === "object" && raw !== null ? raw : {}), sourceType: "QUOTE", sourceId: id });

    const invoice = await createPartialInvoice(org.id, body, { actor });
    return NextResponse.json({ id: invoice.id, status: invoice.status, type: invoice.type }, { status: 201 });
  } catch (e) {
    // Nit (Fix-Welle): ein fehlerhafter JSON-Body wirft SyntaxError aus JSON.parse und
    // landete vorher ungefangen im generischen 500-Handler unten.
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
    console.error("POST /api/documents/[id]/partial-invoice:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
