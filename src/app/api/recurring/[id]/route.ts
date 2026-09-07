import { NextResponse } from "next/server";
import { z } from "zod";
import { updateRecurringStatusSchema } from "@/schemas";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { updateRecurringInvoice } from "@/domain/recurring/update";
import { RecurringError } from "@/domain/recurring/create";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";

/**
 * Reiner Statuswechsel (Task 1/2, unveraendert): `{ status }` allein. Fuer alle anderen
 * Felder (Titel/Rhythmus/Enddatum/maxRuns/… — Task 4, §43) `{ patch: {...} }` verwenden,
 * das an `updateRecurringInvoice` (Zod: `updateRecurringSchema`) geht. Beide Formen sind
 * ueber denselben Endpunkt erreichbar, damit das Bearbeiten-Formular NICHT zwei Routen
 * braucht.
 *
 * Fix-Welle (Nit): der reine Statuswechsel lief vorher an `updateRecurringInvoice` VORBEI
 * (direktes `prisma.recurringInvoice.updateMany`) — damit konnte ein ENDED-Abo ueber
 * diesen Pfad reaktiviert werden, ohne die maxRuns/issuedCount-Pruefung zu durchlaufen
 * (Bypass). Beide Formen gehen jetzt durch `updateRecurringInvoice`.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const body: unknown = await req.json();

    if (body && typeof body === "object" && "patch" in body) {
      const updated = await updateRecurringInvoice(org.id, id, (body as { patch: unknown }).patch, actor);
      return NextResponse.json(updated);
    }

    const { status } = updateRecurringStatusSchema.parse(body);
    const updated = await updateRecurringInvoice(org.id, id, { status }, actor);
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof InvalidOperationError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof RecurringError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("PATCH /api/recurring/[id]:", e);
    return NextResponse.json({ error: "Abo konnte nicht geändert werden." }, { status: 400 });
  }
}
