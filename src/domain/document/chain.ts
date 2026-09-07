/**
 * Dokumentkette als Baum: von der Wurzel (am weitesten zurueckverfolgbarer
 * Vorgaenger) ueber alle per DocumentRelation verknuepften Belege bis zu den
 * Blaettern (Zahlungen/Mahnungen). Dient der UI (Task 5), daher `internalNotes`
 * NIE in einem Knoten — nur Anzeige-Metadaten (Nummer, Status, Link).
 */
import { dbInternal } from "@/lib/db";
import { listRelations } from "@/domain/relations";
import { DocRefType } from "@/schemas";
import { DOC_TYPE_LABEL } from "@/lib/email/doc-type-labels";
import { formatCents } from "@/lib/money";
import type { z } from "zod";

type RefType = z.infer<typeof DocRefType>;

export interface ChainNode {
  type: "QUOTE" | "INVOICE" | "DELIVERY_NOTE" | "DUNNING" | "PAYMENT" | "RECURRING";
  id: string;
  label: string;
  number: string | null;
  status: string;
  href: string | null;
  relation?: string;
  children: ChainNode[];
}

const MAX_ROOT_DEPTH = 6;

// Task 4 (Phase 5): PARTIAL_OF/DOWNPAYMENT_OF/FINAL_FOR zeigen — anders als
// CONVERTED_TO/CORRECTS/REVERSES/GENERATED_BY/DELIVERED_BY — VON der Rechnung AUF ihre
// Quelle (Task-2-Facts: "from Rechnung, to Quelle"). Fuer die Kettenanzeige ist die
// Quelle trotzdem der "Elternknoten" (wie bei CONVERTED_TO) — Root-Suche und
// Kind-Expansion muessen daher beide Richtungen behandeln.
const REVERSE_DIRECTION_RELATIONS = new Set(["PARTIAL_OF", "DOWNPAYMENT_OF", "FINAL_FOR"]);

interface NodeData {
  number: string | null;
  status: string;
  kind?: string;
  invoiceType?: string;
  invoiceId?: string;
}

/** Laedt Anzeigedaten eines Belegs mandantengeprueft. `null`, wenn nicht gefunden/fremde Org. */
async function fetchNodeData(orgId: string, type: RefType, id: string): Promise<NodeData | null> {
  switch (type) {
    case "QUOTE": {
      const q = await dbInternal.quote.findFirst({ where: { id, orgId }, select: { number: true, status: true, kind: true } });
      return q ? { number: q.number, status: q.status, kind: q.kind } : null;
    }
    case "INVOICE": {
      const inv = await dbInternal.invoice.findFirst({ where: { id, orgId }, select: { number: true, status: true, type: true } });
      return inv ? { number: inv.number, status: inv.status, invoiceType: inv.type } : null;
    }
    case "DELIVERY_NOTE": {
      const n = await dbInternal.deliveryNote.findFirst({ where: { id, orgId }, select: { number: true, status: true } });
      return n ? { number: n.number, status: n.status } : null;
    }
    case "DUNNING": {
      const d = await dbInternal.dunning.findFirst({ where: { id, invoice: { orgId } }, select: { number: true, level: true, invoiceId: true } });
      return d ? { number: d.number, status: `MAHNSTUFE_${d.level}`, invoiceId: d.invoiceId } : null;
    }
    case "RECURRING": {
      const r = await dbInternal.recurringInvoice.findFirst({ where: { id, orgId }, select: { status: true } });
      return r ? { number: null, status: r.status } : null;
    }
    default:
      return null;
  }
}

function labelFor(type: RefType, data: NodeData): string {
  switch (type) {
    case "QUOTE":
      return DOC_TYPE_LABEL[(data.kind ?? "ANGEBOT") as keyof typeof DOC_TYPE_LABEL] ?? (data.kind ?? "Angebot");
    case "INVOICE":
      return data.invoiceType === "CREDIT_NOTE" ? DOC_TYPE_LABEL.CREDIT_NOTE : DOC_TYPE_LABEL.INVOICE;
    case "DELIVERY_NOTE":
      return DOC_TYPE_LABEL.DELIVERY_NOTE;
    case "DUNNING":
      return DOC_TYPE_LABEL.DUNNING;
    case "RECURRING":
      return "Abo";
    default:
      return type;
  }
}

function hrefFor(type: RefType, id: string, data: NodeData): string | null {
  switch (type) {
    case "QUOTE":
      return `/dokumente/${id}`;
    case "INVOICE":
      return `/rechnungen/${id}`;
    case "DELIVERY_NOTE":
      return `/lieferscheine/${id}`;
    case "DUNNING":
      return `/rechnungen/${data.invoiceId}`;
    case "RECURRING":
      return `/abos/${id}`;
    default:
      return null;
  }
}

/**
 * Verfolgt Relationen rueckwaerts (toType/toId == aktueller Knoten) bis zu
 * MAX_ROOT_DEPTH Ebenen oder bis kein Vorgaenger mehr existiert bzw. ein Zyklus
 * erkannt wird (Set bereits besuchter Knoten).
 */
async function findRoot(orgId: string, type: RefType, id: string): Promise<{ type: RefType; id: string }> {
  let cur = { type, id };
  const visited = new Set<string>([`${type}:${id}`]);

  for (let depth = 0; depth < MAX_ROOT_DEPTH; depth++) {
    const relations = await listRelations(orgId, cur.type, cur.id);
    // G6 (Fix-Runde 2): DUPLICATED_FROM (from = Kopie, to = Quelle) beim Rueckwaertslauf
    // ueberspringen — sonst wuerde das Oeffnen des Originals faelschlich eine spaeter davon
    // gezogene Kopie als Vorgaenger/Wurzel behandeln. Die Kopie wird stattdessen im
    // Vorwaertsbaum als Blatt angezeigt (buildNode).
    // Task 4: PARTIAL_OF/DOWNPAYMENT_OF/FINAL_FOR muessen hier ausgeschlossen werden —
    // sonst wuerde eine an DIESEM Knoten "ankommende" Relation dieser Art (z. B. eine
    // Abschlagsrechnung, die auf ein Angebot zeigt) faelschlich die Rechnung als
    // Elternknoten des Angebots behandeln (genau umgekehrt zur Kettenlogik).
    const incoming = relations.find((r) => r.toType === cur.type && r.toId === cur.id && r.relationType !== "DUPLICATED_FROM" && !REVERSE_DIRECTION_RELATIONS.has(r.relationType));
    // PARTIAL_OF/DOWNPAYMENT_OF/FINAL_FOR laufen umgekehrt (from = diese Rechnung,
    // to = Quelle) — der "Elternknoten" ist hier `to`, nicht `from`.
    const reverseParent = relations.find((r) => r.fromType === cur.type && r.fromId === cur.id && REVERSE_DIRECTION_RELATIONS.has(r.relationType));
    const parent = incoming ? { type: incoming.fromType as RefType, id: incoming.fromId } : reverseParent ? { type: reverseParent.toType as RefType, id: reverseParent.toId } : null;
    if (!parent) break;

    const key = `${parent.type}:${parent.id}`;
    if (visited.has(key)) break; // Zyklus — hier abbrechen, letzter gueltiger Knoten bleibt Wurzel
    visited.add(key);
    cur = parent;
  }

  return cur;
}

/**
 * Baut einen NICHT expandierten Blattknoten fuer eine DUPLICATED_FROM-Relation (G6,
 * Fix-Runde 2) — `relationLabel` unterscheidet die Blickrichtung ("Kopie von" = dieser
 * Knoten ist die Quelle, das Kind die Kopie; "Kopie" = dieser Knoten ist die Kopie,
 * das Kind die Quelle).
 */
async function buildDuplicateLeaf(orgId: string, type: RefType, id: string, relationLabel: "Kopie von" | "Kopie"): Promise<ChainNode> {
  const data = await fetchNodeData(orgId, type, id);
  if (!data) {
    return { type, id, label: type, number: null, status: "UNBEKANNT", href: null, relation: relationLabel, children: [] };
  }
  return {
    type,
    id,
    label: labelFor(type, data),
    number: data.number,
    status: data.status,
    href: hrefFor(type, id, data),
    relation: relationLabel,
    children: [],
  };
}

/** Baut rekursiv den Teilbaum ab (type, id). `visited` verhindert Endlosschleifen bei Zyklen. */
async function buildNode(orgId: string, type: RefType, id: string, relation: string | undefined, visited: Set<string>): Promise<ChainNode> {
  const key = `${type}:${id}`;
  const data = await fetchNodeData(orgId, type, id);
  if (!data) {
    // Beleg existiert (laut Relation), ist aber nicht (mehr) sichtbar/vorhanden — als Platzhalterblatt zeigen statt abzubrechen.
    return { type, id, label: type, number: null, status: "UNBEKANNT", href: null, relation, children: [] };
  }

  const node: ChainNode = {
    type,
    id,
    label: labelFor(type, data),
    number: data.number,
    status: data.status,
    href: hrefFor(type, id, data),
    ...(relation ? { relation } : {}),
    children: [],
  };

  if (visited.has(key)) return node; // Zyklus: Knoten anzeigen, aber nicht weiter expandieren
  visited.add(key);

  const relations = await listRelations(orgId, type, id);
  // G6 (Fix-Runde 2): DUPLICATED_FROM nie regulaer absteigen — weder wenn DIESER Knoten
  // die Kopie ist (fromId == id, zeigt auf die Quelle) noch wenn er die Quelle ist
  // (toId == id, eine spaetere Kopie zeigt auf ihn). Beide Faelle werden als Blatt
  // angehaengt, damit ein Duplikat die Kette nicht faelschlich fortsetzt.
  const outgoing = relations.filter((r) => r.fromType === type && r.fromId === id && r.relationType !== "DUPLICATED_FROM");
  const outgoingDuplicates = relations.filter((r) => r.fromType === type && r.fromId === id && r.relationType === "DUPLICATED_FROM");
  const incomingDuplicates = relations.filter((r) => r.toType === type && r.toId === id && r.relationType === "DUPLICATED_FROM");

  for (const r of outgoing) {
    const childKey = `${r.toType}:${r.toId}`;
    if (visited.has(childKey)) continue;
    node.children.push(await buildNode(orgId, r.toType as RefType, r.toId, r.relationType, visited));
  }

  // Task 4: PARTIAL_OF/DOWNPAYMENT_OF/FINAL_FOR zeigen von der Rechnung auf die Quelle
  // (siehe REVERSE_DIRECTION_RELATIONS oben) — aus Sicht DIESES Knotens (der Quelle) sind
  // das eingehende Relationen, aber fachlich Kinder (verknuepfte Teil-/Abschlags-/
  // Schlussrechnungen), also wie `outgoing` als Kind-Knoten expandiert.
  const incomingBilling = relations.filter((r) => r.toType === type && r.toId === id && REVERSE_DIRECTION_RELATIONS.has(r.relationType));
  for (const r of incomingBilling) {
    const childKey = `${r.fromType}:${r.fromId}`;
    if (visited.has(childKey)) continue;
    node.children.push(await buildNode(orgId, r.fromType as RefType, r.fromId, r.relationType, visited));
  }

  for (const r of outgoingDuplicates) {
    node.children.push(await buildDuplicateLeaf(orgId, r.toType as RefType, r.toId, "Kopie von"));
  }
  for (const r of incomingDuplicates) {
    node.children.push(await buildDuplicateLeaf(orgId, r.fromType as RefType, r.fromId, "Kopie"));
  }

  if (type === "INVOICE") {
    const payments = await dbInternal.payment.findMany({ where: { invoiceId: id }, orderBy: { paidAt: "asc" } });
    for (const p of payments) {
      node.children.push({
        type: "PAYMENT",
        id: p.id,
        label: `Zahlung ${formatCents(p.amountCents)}`,
        number: null,
        status: p.method,
        href: null,
        children: [],
      });
    }

    const dunnings = await dbInternal.dunning.findMany({ where: { invoiceId: id }, orderBy: { createdAt: "asc" } });
    for (const d of dunnings) {
      node.children.push({
        type: "DUNNING",
        id: d.id,
        label: DOC_TYPE_LABEL.DUNNING,
        number: d.number,
        status: `MAHNSTUFE_${d.level}`,
        href: `/rechnungen/${id}`,
        children: [],
      });
    }
  }

  return node;
}

/**
 * Baut den vollstaendigen Dokumentbaum zu einem Beleg: Wurzel ist der am weitesten
 * zurueckverfolgbare Vorgaenger, `currentId` markiert den urspruenglich angefragten
 * Knoten fuer die UI-Hervorhebung. Wirft bei fremder Org oder unbekanntem Beleg.
 */
export async function buildDocumentChain(orgId: string, type: RefType, id: string): Promise<{ root: ChainNode; currentId: string }> {
  const parsedType = DocRefType.parse(type);
  const exists = await fetchNodeData(orgId, parsedType, id);
  if (!exists) throw new Error(`${parsedType} ${id} nicht gefunden (oder falsche Organisation).`);

  const rootRef = await findRoot(orgId, parsedType, id);
  const root = await buildNode(orgId, rootRef.type, rootRef.id, undefined, new Set());

  return { root, currentId: id };
}
