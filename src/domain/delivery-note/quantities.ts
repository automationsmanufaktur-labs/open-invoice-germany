/**
 * Restmengen einer Angebots-/AB-/Rechnungsposition: bestellte Menge minus bereits
 * gelieferte Menge (Summe ueber nicht-stornierte Lieferscheine). Grundlage fuer die
 * Teillieferung (src/domain/document/convert.ts).
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";

export class OverDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverDeliveryError";
  }
}

// Wie ensure.ts: Aufrufer koennen entweder den globalen Client oder einen
// Transaktions-Client uebergeben, damit Laden + Pruefung wahlweise INNERHALB einer
// laufenden $transaction laufen koennen (Fix-Runde 2, W1 — Race unter Postgres
// READ COMMITTED sonst zwischen Lesen und Schreiben, siehe LIMITATIONEN.md).
type Db = PrismaClient | Prisma.TransactionClient;

export type DeliverySourceType = "QUOTE" | "INVOICE";

export interface SourceLine {
  id: string;
  description: string;
  unit: string;
  quantityMilli: number;
  unitNetPriceCents: number;
  taxRate: number;
}

export interface RemainingQuantity {
  sourceLineId: string;
  description: string;
  unit: string;
  orderedMilli: number;
  deliveredMilli: number;
  remainingMilli: number;
}

/** Laedt die Quellpositionen (QuoteLine bzw. InvoiceLine) mandantengeprueft. */
export async function loadSourceLines(
  orgId: string,
  sourceType: DeliverySourceType,
  sourceId: string,
  db: Db = dbInternal,
): Promise<{ customerId: string; lines: SourceLine[] }> {
  if (sourceType === "QUOTE") {
    const q = await db.quote.findFirst({
      where: { id: sourceId, orgId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!q) throw new NotFoundError(`Angebot/Auftragsbestaetigung ${sourceId} nicht gefunden.`);
    return {
      customerId: q.customerId,
      lines: q.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, quantityMilli: l.quantityMilli, unitNetPriceCents: l.unitNetPriceCents, taxRate: l.taxRate })),
    };
  }
  const inv = await db.invoice.findFirst({
    where: { id: sourceId, orgId },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!inv) throw new NotFoundError(`Rechnung ${sourceId} nicht gefunden.`);
  return {
    customerId: inv.customerId,
    lines: inv.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, quantityMilli: l.quantityMilli, unitNetPriceCents: l.unitNetPriceCents, taxRate: l.taxRate })),
  };
}

// Nur Lieferscheine, die tatsaechlich "unterwegs" oder angekommen sind, zaehlen als geliefert.
// DRAFT (Formular-Zwischenspeicherung, Task 5) ist noch kein wirksamer Beleg und CANCELLED
// ist storniert — beide zaehlen NICHT mit (nicht nur "!= CANCELLED", sonst wuerde ein
// DRAFT-Duplikat faelschlich die Restmenge reduzieren).
const DELIVERED_STATUSES = ["CREATED", "SENT", "DELIVERED"] as const;

/**
 * Restmenge je Quellposition: bestellte Menge minus die Summe der DeliveryNoteLine-Mengen
 * ueber alle wirksamen Lieferscheine (status CREATED/SENT/DELIVERED) derselben Organisation
 * mit passender sourceLineId. `db` optional als Transaktions-Client (siehe loadSourceLines).
 */
export async function remainingQuantities(orgId: string, sourceType: DeliverySourceType, sourceId: string, db: Db = dbInternal): Promise<RemainingQuantity[]> {
  const { lines } = await loadSourceLines(orgId, sourceType, sourceId, db);
  const ids = lines.map((l) => l.id);

  const delivered = ids.length
    ? await db.deliveryNoteLine.groupBy({
        by: ["sourceLineId"],
        where: { sourceLineId: { in: ids }, deliveryNote: { orgId, status: { in: [...DELIVERED_STATUSES] } } },
        _sum: { quantityMilli: true },
      })
    : [];
  const deliveredMap = new Map<string, number>(delivered.map((d) => [d.sourceLineId as string, d._sum.quantityMilli ?? 0]));

  return lines.map((l) => {
    const deliveredMilli = deliveredMap.get(l.id) ?? 0;
    return {
      sourceLineId: l.id,
      description: l.description,
      unit: l.unit,
      orderedMilli: l.quantityMilli,
      deliveredMilli,
      remainingMilli: l.quantityMilli - deliveredMilli,
    };
  });
}

/** Wirft OverDeliveryError, wenn eine angeforderte Menge die Restmenge uebersteigt. Menge 0 = Position weglassen. */
export function assertNoOverDelivery(
  remaining: RemainingQuantity[],
  requested: Array<{ sourceLineId: string; quantityMilli: number }>,
): void {
  const byId = new Map(remaining.map((r) => [r.sourceLineId, r]));
  for (const req of requested) {
    if (req.quantityMilli === 0) continue;
    const r = byId.get(req.sourceLineId);
    if (!r) throw new OverDeliveryError(`Quellposition ${req.sourceLineId} unbekannt.`);
    if (req.quantityMilli > r.remainingMilli) {
      throw new OverDeliveryError(
        `Menge ${req.quantityMilli} ueberschreitet die Restmenge ${r.remainingMilli} fuer Position "${r.description}".`,
      );
    }
  }
}
