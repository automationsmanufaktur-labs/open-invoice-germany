import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { revealShareLinkToken } from "@/domain/quote-share/link";
import { getActiveOrg } from "@/lib/org";
import { resolveBaseUrl } from "@/lib/http/base-url";

export const runtime = "nodejs";

/**
 * Betreiber-Route (Adjudikation Task-1): liefert die Klartext-URL eines bestehenden
 * Angebotslinks, org-geprueft. Entschluesselt serverseitig `tokenEnc` (AUTH_SECRET) —
 * NIE in einer oeffentlichen `/api/public/`-Route verwenden. `404`, wenn der Link nicht
 * existiert, keine Verschluesselung gespeichert ist (Alt-Link) oder AUTH_SECRET seither
 * rotiert wurde (Entschluesselung schlaegt fehl).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const { linkId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const token = await revealShareLinkToken(org.id, linkId);
    if (!token) return NextResponse.json({ error: "Link nicht gefunden oder Token nicht mehr lesbar" }, { status: 404 });

    const baseUrl = resolveBaseUrl(await headers());
    return NextResponse.json({ url: `${baseUrl}/angebot/${token}` });
  } catch (e) {
    console.error("GET /api/documents/[id]/share-links/[linkId]/token:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
