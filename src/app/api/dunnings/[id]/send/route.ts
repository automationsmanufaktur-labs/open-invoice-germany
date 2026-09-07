/**
 * Mahnung senden ohne den vollen SendEmailDialog-Vorbelegungspfad zu durchlaufen
 * (z. B. fuer eine schnelle "Senden"-Aktion in der /mahnwesen-Tabelle bzw. das MCP-Tool
 * `send_dunning`) — nutzt dieselbe Domain-Funktion (`sendDunning`, Task 2) wie
 * `/api/emails/send` fuer docType DUNNING, kein zweiter Versandpfad.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { sendDunning } from "@/domain/dunning/send";
import { DunningError } from "@/domain/dunning/create";
import { MailNotConfiguredError } from "@/domain/email/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ to: z.email().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const bodyText = await req.text();
    const input = bodySchema.parse(bodyText ? JSON.parse(bodyText) : {});
    const result = await sendDunning(org.id, id, { actor, to: input.to });
    if (result.status === "FAILED") {
      return NextResponse.json({ error: result.error ?? "Versand fehlgeschlagen." }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof MailNotConfiguredError) {
      return NextResponse.json({ error: "MAIL_NOT_CONFIGURED" }, { status: 409 });
    }
    if (e instanceof DunningError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/dunnings/[id]/send:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
