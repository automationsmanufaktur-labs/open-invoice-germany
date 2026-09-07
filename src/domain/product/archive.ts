/**
 * Produkt archivieren (Phase 9, Task 1 — reiner Move aus src/app/actions/masterdata.ts:
 * archiveProduct). Domain-Funktion, damit Server Action UND MCP-Tool (archive_product)
 * dieselbe Logik nutzen (Lastenheft §55, keine Bypass-Pfade).
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export async function archiveProduct(orgId: string, id: string): Promise<void> {
  const res = await dbInternal.product.updateMany({ where: { id, orgId }, data: { isArchived: true } });
  if (res.count === 0) throw new NotFoundError("Produkt nicht gefunden.");
}
