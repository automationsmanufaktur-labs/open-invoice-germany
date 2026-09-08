import { NextResponse } from "next/server";
import { dbInternal } from "@/lib/db";
import { billingStateFor } from "@/domain/document/billing-state";
import { billedLineDetails } from "@/domain/invoice/billed-quantities";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";

export const runtime = "nodejs";

/**
 * Task 4 (Facts): Abrechnungsstand eines Angebots/einer Auftragsbestaetigung fuer die
 * ConvertMenu-Dialoge (Teilrechnung/Abschlagsrechnung/Schlussrechnung) — kombiniert
 * `billingStateFor` (Task 2) mit den je Position bereits abgerechneten Mengen
 * (`billedLineDetails`, analog GET /api/documents/[id]/remaining).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const quote = await dbInternal.quote.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!quote) throw new NotFoundError(`Angebot/Auftragsbestaetigung ${id} nicht gefunden.`);

    const [billing, lines] = await Promise.all([billingStateFor(org.id, "QUOTE", id), billedLineDetails(org.id, id)]);

    return NextResponse.json({
      state: billing.state,
      billedPermille: billing.billedPermille,
      downpaymentGrossCents: billing.downpaymentGrossCents,
      hasActiveFinal: billing.hasActiveFinal,
      invoiceIds: billing.invoiceIds,
      lines,
    });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("GET /api/documents/[id]/billing:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
