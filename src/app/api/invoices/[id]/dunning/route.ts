import { NextResponse } from "next/server";
import { z } from "zod";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { createDunning, DunningError } from "@/domain/dunning/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Task 4: `force` erzwingt die Erstellung vor Faelligkeit der naechsten Stufe (mit
// Bestaetigung im UI); `lateFeeCents` sind konkrete Zusatzkosten, nur wirksam ab
// Stufe order >= 2 (create.ts).
const bodySchema = z.object({
  force: z.boolean().optional(),
  lateFeeCents: z.number().int().min(0).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    // Org-Pruefung wie bei .../payment (vorbestehende Luecke: createDunning laedt die
    // Rechnung ohne orgId-Filter, siehe domain/dunning/create.ts) — Route prueft daher
    // vorab, dass die Rechnung der aktiven Organisation gehoert.
    const org = await getActiveOrg();
    const owned = await dbInternal.invoice.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });

    const actor = (await getCurrentUserId()) ?? "system";
    const bodyText = await req.text();
    const input = bodySchema.parse(bodyText ? JSON.parse(bodyText) : {});

    const res = await createDunning(id, {
      actor,
      force: input.force,
      lateFeeCents: input.lateFeeCents,
    });
    return NextResponse.json({ dunningId: res.dunning.id, number: res.dunning.number, level: res.level, stage: res.stage });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof DunningError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/invoices/[id]/dunning:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
