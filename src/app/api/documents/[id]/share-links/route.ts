import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { createShareLink, listShareLinks, ShareLinkError } from "@/domain/quote-share/link";
import { NotFoundError } from "@/domain/errors";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { resolveBaseUrl } from "@/lib/http/base-url";
import { SecretsUnavailableError } from "@/lib/crypto/secrets";

export const runtime = "nodejs";

/**
 * Betreiber-Routen fuer Angebotslinks (Phase 3b, Task 3). Der Klartext-Token verlaesst
 * die Domain-Funktion `createShareLink` nur einmal (in der POST-Antwort) — GET liefert
 * ausschliesslich Metadaten, nie den Token (siehe QuoteShareLink.tokenHash).
 */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const links = await listShareLinks(org.id, id);
    return NextResponse.json({
      links: links.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        expiresAt: l.expiresAt,
        revokedAt: l.revokedAt,
        viewCount: l.viewCount,
        lastViewedAt: l.lastViewedAt,
        decidedAt: l.decidedAt,
        decision: l.decision,
        deciderName: l.deciderName,
      })),
    });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("GET /api/documents/[id]/share-links:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const body = await req.json().catch(() => ({}));
    const { link, token } = await createShareLink(org.id, id, body, { actor });

    const baseUrl = resolveBaseUrl(await headers());
    const url = `${baseUrl}/angebot/${token}`;

    return NextResponse.json({ id: link.id, url, expiresAt: link.expiresAt }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ShareLinkError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof SecretsUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("POST /api/documents/[id]/share-links:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
