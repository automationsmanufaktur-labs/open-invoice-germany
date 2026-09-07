/**
 * Mahnstufen-Verwaltung (Phase 6, Task 1) — Stammdaten, kein Beleg, daher kein
 * ChangeLog (nur Belegereignisse gehen in die Hash-Kette, Ruling Audit K5).
 *
 * `order` wird nie vom Client gesetzt: `createDunningStage` haengt die naechste freie
 * Nummer an, `updateDunningStage` kennt die bestehende aus der DB. Beide reichen den
 * Wert an `dunningStageInputSchema` weiter, damit die feeCents/order-Regel
 * (COMPLIANCE §12: Mahnkosten erst ab Stufe ≥ 2) greift.
 */
import { dbInternal } from "@/lib/db";
import {
  dunningStageFieldsSchema,
  dunningStageInputSchema,
  dunningStagesReorderSchema,
  type DunningStageFieldsInput,
} from "@/schemas";

export class DunningStageError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DunningStageError";
  }
}

export class DunningStageNotFoundError extends DunningStageError {
  constructor() {
    super("Mahnstufe nicht gefunden.", 404);
    this.name = "DunningStageNotFoundError";
  }
}

// 409: bewusst kein Loeschen einer bereits verwendeten Stufe (Mahnungen referenzieren
// sie per stageId) — der Aufrufer soll stattdessen ueber updateDunningStage
// `enabled: false` setzen, damit dunningScheduleFor sie uebergeht.
export class DunningStageInUseError extends DunningStageError {
  constructor() {
    super("Mahnstufe ist mit bestehenden Mahnungen verknuepft und kann nicht geloescht werden. Stattdessen deaktivieren (enabled=false).", 409);
    this.name = "DunningStageInUseError";
  }
}

/** Alle Mahnstufen einer Organisation, aufsteigend nach `order`. */
export async function listDunningStages(orgId: string) {
  return dbInternal.dunningStage.findMany({ where: { orgId }, orderBy: { order: "asc" } });
}

/** Legt eine neue Mahnstufe an; `order` = aktuelles Maximum + 1 (0, wenn noch keine existiert). */
export async function createDunningStage(orgId: string, rawInput: unknown) {
  const fields = dunningStageFieldsSchema.parse(rawInput);
  const agg = await dbInternal.dunningStage.aggregate({ where: { orgId }, _max: { order: true } });
  const order = (agg._max.order ?? -1) + 1;
  const validated = dunningStageInputSchema.parse({ ...fields, order });
  return dbInternal.dunningStage.create({ data: { orgId, ...validated } });
}

/** Aktualisiert eine bestehende Mahnstufe; `order` bleibt unveraendert (siehe reorderDunningStages). */
export async function updateDunningStage(orgId: string, id: string, rawInput: unknown) {
  const existing = await dbInternal.dunningStage.findFirst({ where: { id, orgId } });
  if (!existing) throw new DunningStageNotFoundError();
  const fields = dunningStageFieldsSchema.parse(rawInput);
  const validated = dunningStageInputSchema.parse({ ...fields, order: existing.order });
  return dbInternal.dunningStage.update({ where: { id }, data: validated });
}

/**
 * Loescht eine Mahnstufe — nur, wenn keine Mahnung sie referenziert (409 sonst, siehe
 * DunningStageInUseError). Bestehende Mahnungen sind unveraenderlich (GoBD) und muessten
 * sonst verwaist zurueckbleiben oder die Stufe faelschlich mitgeloescht werden.
 */
export async function deleteDunningStage(orgId: string, id: string): Promise<void> {
  const existing = await dbInternal.dunningStage.findFirst({ where: { id, orgId } });
  if (!existing) throw new DunningStageNotFoundError();
  const inUse = await dbInternal.dunning.count({ where: { stageId: id } });
  if (inUse > 0) throw new DunningStageInUseError();
  await dbInternal.dunningStage.delete({ where: { id } });
}

/**
 * Setzt die Reihenfolge aller Mahnstufen einer Organisation neu (Drag&Drop-Sortierung).
 * `ids` muss GENAU die Menge der vorhandenen Stufen-Ids der Organisation enthalten (nicht
 * mehr, nicht weniger) — sonst bliebe eine Stufe ohne definierte Position oder eine
 * fremde/fehlende Id würde stillschweigend ignoriert.
 *
 * Zweiphasig wegen `@@unique([orgId, order])`: zuerst alle Stufen auf negative,
 * garantiert kollisionsfreie Platzhalter (−(i+1)) setzen, danach erst auf die
 * tatsaechliche Zielposition (i) — sonst würde eine Zwischenzuweisung den bestehenden
 * Unique-Index verletzen (z. B. Tausch zweier Positionen).
 */
export async function reorderDunningStages(orgId: string, rawInput: unknown): Promise<void> {
  const { ids } = dunningStagesReorderSchema.parse(rawInput);
  const existing = await dbInternal.dunningStage.findMany({ where: { orgId }, select: { id: true, feeCents: true } });
  const existingIds = new Set(existing.map((s) => s.id));
  const inputIds = new Set(ids);
  if (ids.length !== existing.length || existingIds.size !== inputIds.size || ids.some((id) => !existingIds.has(id))) {
    throw new DunningStageError("ids muss genau die vorhandenen Mahnstufen-Ids der Organisation enthalten.");
  }

  // S3 (Fix-Welle): Reorder darf die feeCents/order>=2-Regel (COMPLIANCE §12) nicht
  // verletzen. Ohne diese Pruefung wuerde eine Stufe mit Mahnkosten auf order < 0/1
  // wandern: create.ts (order >= 2) bucht die Gebuehr dann stillschweigend nicht mehr,
  // obwohl die UI sie weiterhin anzeigt — und die Zeile waere ueber updateDunningStage
  // (dieselbe Zod-Regel) auch nicht mehr speicherbar, eine UI-Sackgasse. Alle Stufen
  // erneut pruefen, BEVOR irgendetwas geschrieben wird (409, kein Teilzustand).
  const feeById = new Map(existing.map((s) => [s.id, s.feeCents]));
  ids.forEach((id, index) => {
    const feeCents = feeById.get(id) ?? 0;
    if (feeCents > 0 && index < 2) {
      throw new DunningStageError(
        `Reorder abgelehnt: Eine Stufe mit Mahnkosten (${(feeCents / 100).toFixed(2)} €) kaeme auf Position ${index} — Mahnkosten sind erst ab der 2. Mahnstufe zulässig (order ≥ 2, COMPLIANCE §12). Zuerst die Mahnkosten auf 0 setzen oder die Stufe weiter hinten einsortieren.`,
        409,
      );
    }
  });

  await dbInternal.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.dunningStage.update({ where: { id: ids[i] }, data: { order: -(i + 1) } });
    }
    for (let i = 0; i < ids.length; i++) {
      await tx.dunningStage.update({ where: { id: ids[i] }, data: { order: i } });
    }
  });
}

export type { DunningStageFieldsInput };
