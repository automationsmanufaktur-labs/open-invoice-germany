import { NextResponse } from "next/server";
import { z } from "zod";
import { documentStatusActionSchema } from "@/schemas";
import { setDeliveryNoteStatus, setArchived, StatusTransitionError } from "@/domain/document/status";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

const ACTION_TARGET = {
  MARK_CREATED: "CREATED",
  MARK_SENT: "SENT",
  MARK_DELIVERED: "DELIVERED",
  CANCEL: "CANCELLED",
} as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const input = documentStatusActionSchema.parse(await req.json());

    if (input.action === "ARCHIVE" || input.action === "UNARCHIVE") {
      await setArchived(org.id, "DELIVERY_NOTE", id, input.action === "ARCHIVE", actor);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "MARK_ACCEPTED" || input.action === "MARK_REJECTED") {
      return NextResponse.json({ error: `${input.action} ist fuer Lieferscheine nicht gueltig.` }, { status: 400 });
    }

    const target = ACTION_TARGET[input.action];
    const updated = await setDeliveryNoteStatus(org.id, id, target, { actor, note: input.note });
    return NextResponse.json({ id: updated.id, status: updated.status, number: updated.number });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof StatusTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/delivery-notes/[id]/status:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
