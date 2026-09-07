import { NextResponse } from "next/server";
import { z } from "zod";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { recordPaymentSchema } from "@/schemas";
import { recordPayment, PaymentError } from "@/domain/invoice/payment";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    // G — Org-Pruefung wie bei GET .../skonto-check (vorbestehende Luecke: recordPayment
    // laedt die Rechnung ohne orgId-Filter, jede authentifizierte Organisation konnte
    // ueber die reine ID eine fremde Rechnung bezahlen).
    const org = await getActiveOrg();
    const owned = await dbInternal.invoice.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });

    const input = recordPaymentSchema.parse(await req.json());
    const result = await recordPayment(id, input);
    return NextResponse.json({
      status: result.payment.status,
      paidAmountCents: result.payment.paidAmountCents,
      skontoSuggestion: result.skontoSuggestion ?? null,
      skontoApplied: !!result.skontoPayment,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    const status = e instanceof PaymentError ? 422 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
