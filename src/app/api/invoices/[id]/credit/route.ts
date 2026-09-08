import { NextResponse } from "next/server";
import { z } from "zod";
import { partialCreditSchema } from "@/schemas";
import { createPartialCreditNote, CreditError } from "@/domain/invoice/credit";
import { TaxRateNotAllowedError } from "@/domain/settings/tax-rates";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const input = partialCreditSchema.parse(await req.json());
    const res = await createPartialCreditNote(id, input);
    return NextResponse.json({ creditNoteId: res.creditNote.id, creditNoteNumber: res.creditNote.number });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    // Fix-Welle 12c (I2): TaxRateNotAllowedError fiel vorher unter den generischen
    // 500-Zweig — derselbe Konflikt liefert am /api/v1-Zwilling bereits 409
    // (DOMAIN_CONFLICT_ERROR_CLASSES, src/api/errors.ts), diese Session-Route soll sich
    // nicht unterscheiden (Controller-Ruling).
    if (e instanceof TaxRateNotAllowedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const status = e instanceof CreditError ? 422 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
