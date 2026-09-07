/**
 * Kunde archivieren (Phase 9, Task 1 — reiner Move aus src/app/actions/masterdata.ts:
 * archiveCustomer). Domain-Funktion, damit Server Action UND MCP-Tool (archive_customer)
 * dieselbe Logik nutzen (Lastenheft §55, keine Bypass-Pfade).
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export async function archiveCustomer(orgId: string, id: string): Promise<void> {
  const res = await dbInternal.customer.updateMany({ where: { id, orgId }, data: { isArchived: true } });
  if (res.count === 0) throw new NotFoundError("Kunde nicht gefunden.");
}
