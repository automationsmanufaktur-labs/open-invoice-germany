/**
 * Selbstheilung fuer Altmahnungen (Phase 6, Task 2): Mahnungen aus der Zeit vor Phase 6
 * haben `snapshotSource == null` (Task 1, kein SQL-Backfill moeglich — der historische
 * Kunden-/Firmenstand zum jeweiligen Mahnzeitpunkt ist nicht rekonstruierbar). Diese
 * Funktion baut den Snapshot einmalig aus dem HEUTIGEN Stamm nach, markiert mit Herkunft
 * MIGRATION (statt CREATE), damit unterscheidbar bleibt, dass er nicht zeitgleich mit der
 * Mahnung entstand. `claimBaseCents`/`feeCents` bleiben bewusst 0 (nicht rekonstruierbar,
 * Task-1-Ruling) — die PDF-Erzeugung faellt dafuer weiterhin auf die Live-Berechnung
 * zurueck (siehe dunning-data.ts).
 */
import { dbInternal } from "@/lib/db";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";

export async function ensureDunningSnapshots(orgId: string): Promise<number> {
  const rows = await dbInternal.dunning.findMany({
    where: { snapshotSource: null, invoice: { orgId } },
    include: { invoice: { include: { org: true, customer: true } } },
  });

  let count = 0;
  for (const d of rows) {
    const inv = d.invoice;
    await dbInternal.dunning.update({
      where: { id: d.id },
      data: {
        sellerSnapshotJson: JSON.stringify(buildSellerSnapshot(inv.org)),
        buyerSnapshotJson: JSON.stringify(buildBuyerSnapshot(inv.customer)),
        snapshotSource: "MIGRATION",
        invoiceNumber: inv.number,
        invoiceDueDate: inv.dueDate,
      },
    });
    count++;
  }
  return count;
}
