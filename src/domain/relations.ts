/**
 * Generische Belegverknuepfungen (Phase 1). Polymorph ueber Typ+ID; Existenz wird hier
 * geprueft, weil das Schema keinen Fremdschluessel auf mehrere Tabellen kennt.
 * Die Altfelder an den Belegen bleiben und werden von den Services parallel gesetzt.
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { DocRefType, RelationType } from "@/schemas";
import type { z } from "zod";

type RefType = z.infer<typeof DocRefType>;
type RelType = z.infer<typeof RelationType>;
type Tx = Prisma.TransactionClient;

const TABLE: Record<RefType, "quote" | "invoice" | "recurringInvoice" | "deliveryNote" | "dunning"> = {
  QUOTE: "quote", INVOICE: "invoice", RECURRING: "recurringInvoice", DELIVERY_NOTE: "deliveryNote", DUNNING: "dunning",
};
export function tableForRefType(t: RefType) { return TABLE[t]; }

export class RelationError extends Error { constructor(m: string) { super(m); this.name = "RelationError"; } }

export async function assertDocExists(tx: Tx, orgId: string, type: RefType, id: string): Promise<void> {
  const table = tableForRefType(type);
  // DUNNING hat keine eigene orgId-Spalte -> Mandantenfilter ueber die verknuepfte Rechnung.
  const where = type === "DUNNING" ? { id, invoice: { orgId } } : { id, orgId };
  // Prisma-Delegates sind strukturell gleich fuer findFirst({ where }).
  const found = await (tx[table] as unknown as { findFirst: (a: { where: unknown; select: { id: true } }) => Promise<{ id: string } | null> })
    .findFirst({ where, select: { id: true } });
  if (!found) throw new RelationError(`${type} ${id} existiert nicht.`);
}

export async function linkDocuments(
  tx: Tx,
  rel: { orgId: string; fromType: RefType; fromId: string; toType: RefType; toId: string; relationType: RelType },
) {
  await assertDocExists(tx, rel.orgId, rel.fromType, rel.fromId);
  await assertDocExists(tx, rel.orgId, rel.toType, rel.toId);
  return tx.documentRelation.upsert({
    where: { fromType_fromId_toType_toId_relationType: { fromType: rel.fromType, fromId: rel.fromId, toType: rel.toType, toId: rel.toId, relationType: rel.relationType } },
    create: rel,
    update: {},
  });
}

export function listRelations(orgId: string, docType: RefType, docId: string) {
  return dbInternal.documentRelation.findMany({
    where: { orgId, OR: [{ fromType: docType, fromId: docId }, { toType: docType, toId: docId }] },
    orderBy: { createdAt: "asc" },
  });
}
