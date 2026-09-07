import { getActiveOrg } from "@/lib/org";
import { listShareLinks } from "@/domain/quote-share/link";
import { ShareLinkPanelClient, type ShareLinkRow } from "@/components/ShareLinkPanelClient";

/** Link-Verwaltung fuer Angebote (Phase 3b, Task 3): Serverdaten laden, Client-Teil rendern. */
export async function ShareLinkPanel({ documentId }: { documentId: string }) {
  const org = await getActiveOrg();
  const links = await listShareLinks(org.id, documentId);

  const rows: ShareLinkRow[] = links.map((l) => ({
    id: l.id,
    createdAt: l.createdAt.toISOString(),
    expiresAt: l.expiresAt.toISOString(),
    revokedAt: l.revokedAt?.toISOString() ?? null,
    viewCount: l.viewCount,
    lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
    decidedAt: l.decidedAt?.toISOString() ?? null,
    decision: l.decision,
    deciderName: l.deciderName,
  }));

  return <ShareLinkPanelClient documentId={documentId} initialLinks={rows} />;
}
