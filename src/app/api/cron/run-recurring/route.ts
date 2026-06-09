/**
 * Cron-Endpunkt: erzeugt alle fälligen Abo-Rechnungen.
 *
 * Aufruf z. B. täglich. Schutz: ist CRON_SECRET gesetzt, muss der Header
 *   Authorization: Bearer <CRON_SECRET>   (oder ?secret=<CRON_SECRET>)
 * passen. Ohne gesetztes Secret ist der Endpunkt nur via Self-Hosting-Netz
 * erreichbar — für öffentliche Deployments unbedingt CRON_SECRET setzen.
 */
import { NextResponse } from "next/server";
import { runDueRecurring } from "@/domain/recurring/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  try {
    const summaries = await runDueRecurring();
    const count = summaries.reduce((n, s) => n + s.emitted.length, 0);
    return NextResponse.json({ ok: true, generated: count, abos: summaries });
  } catch (e) {
    console.error("cron/run-recurring:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
