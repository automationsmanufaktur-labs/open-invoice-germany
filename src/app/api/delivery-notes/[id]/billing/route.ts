import { NextResponse } from "next/server";
import { billedLineDetailsForDeliveryNote } from "@/domain/invoice/billed-quantities";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";

export const runtime = "nodejs";

/**
 * B11 (Fix-Welle): Abrechnungsstand eines Lieferscheins fuer den Positions-/Mengen-
 * Dialog von `ConvertMenu` — analog `GET /api/documents/[id]/billing`, aber ohne
 * `billingStateFor` (die gibt es fuer Lieferscheine nicht) und mit `unitNetPriceCents`
 * je Zeile, damit die UI Anteils-Modi nur anbietet, wenn ALLE Zeilen einen Preis haben.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const lines = await billedLineDetailsForDeliveryNote(org.id, id);
    const hasPrices = lines.length > 0 && lines.every((l) => l.unitNetPriceCents != null);
    return NextResponse.json({ lines, hasPrices });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("GET /api/delivery-notes/[id]/billing:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
