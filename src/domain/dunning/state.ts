/**
 * Mahnprozess-Status je Rechnung (Phase 6, Task 2) — ACTIVE/PAUSED/STOPPED. Wirkt nur auf
 * Neuerstellung/-versand (create.ts prueft `dunningState`); bereits erstellte Mahnungen
 * bleiben unveraendert (GoBD).
 */
import { dbInternal } from "@/lib/db";
import { dunningStateInputSchema } from "@/schemas";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { DunningError } from "@/domain/dunning/create";

export async function setDunningState(orgId: string, invoiceId: string, raw: unknown, actor: string) {
  const input = dunningStateInputSchema.parse(raw);
  const now = new Date();

  return dbInternal.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId }, select: { id: true } });
    if (!inv) throw new DunningError("Rechnung nicht gefunden.");

    const pausedUntil = input.state === "PAUSED" && input.pausedUntil ? new Date(input.pausedUntil) : null;

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        dunningState: input.state,
        dunningPausedUntil: pausedUntil,
        dunningStateNote: input.note ?? null,
      },
    });

    await appendChangeLog(tx, {
      orgId,
      entity: "INVOICE",
      entityId: invoiceId,
      action: "DUNNING_STATE",
      actor,
      at: now,
      diff: { state: input.state, pausedUntil: pausedUntil ? pausedUntil.toISOString() : null, note: input.note ?? null },
    });
    await logActivity(tx, {
      orgId,
      entityType: "INVOICE",
      entityId: invoiceId,
      type: "DUNNING_STATE",
      actor,
      at: now,
      data: { state: input.state, pausedUntil: pausedUntil ? pausedUntil.toISOString() : null },
    });

    return { state: input.state, pausedUntil };
  });
}
