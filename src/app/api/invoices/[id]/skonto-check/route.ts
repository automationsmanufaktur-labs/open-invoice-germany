import { NextResponse } from "next/server";
import { z } from "zod";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { skontoCheckQuerySchema } from "@/schemas";
import { skontoTerms, detectSkonto } from "@/lib/pricing/skonto";

export const runtime = "nodejs";

/**
 * Reine Vorschau (kein Schreibvorgang): prueft, ob Betrag+Datum in eine Skontofrist
 * der Rechnung fallen, ohne eine Zahlung zu buchen. Genutzt vom `PaymentForm`, bevor
 * der Nutzer "Buchen" mit `applySkonto` bestaetigt.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const url = new URL(req.url);
    const query = skontoCheckQuerySchema.parse({
      amountCents: url.searchParams.get("amountCents") ?? undefined,
      paidAt: url.searchParams.get("paidAt") ?? undefined,
    });

    const invoice = await dbInternal.invoice.findFirst({
      where: { id, orgId: org.id },
      select: {
        issueDate: true,
        grossTotalCents: true,
        paidAmountCents: true,
        skonto1Permille: true,
        skonto1Days: true,
        skonto2Permille: true,
        skonto2Days: true,
      },
    });
    if (!invoice) return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });

    const openBeforeCents = invoice.grossTotalCents - invoice.paidAmountCents;
    const terms = skontoTerms({
      issueDate: invoice.issueDate,
      grossTotalCents: invoice.grossTotalCents,
      skonto1Permille: invoice.skonto1Permille,
      skonto1Days: invoice.skonto1Days,
      skonto2Permille: invoice.skonto2Permille,
      skonto2Days: invoice.skonto2Days,
    });
    const paidAt = query.paidAt ?? new Date();
    const match = detectSkonto(terms, paidAt, query.amountCents, openBeforeCents);
    const restCents = openBeforeCents - query.amountCents;

    return NextResponse.json({
      suggestion: match ? { ...match, restCents } : null,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/invoices/[id]/skonto-check:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
