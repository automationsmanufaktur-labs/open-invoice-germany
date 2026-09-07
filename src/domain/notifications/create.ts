/**
 * Anlage/Abruf von In-App-Benachrichtigungen (Phase 8b, Task 3). `createNotification`
 * ist "upsert-ignore": `(orgId, dedupeKey)` ist `@@unique` (Fix-Welle: vorher `dedupeKey`
 * global `@unique` — Cross-Tenant-Kopplung in einem sonst strikt org-gescopten Modell) —
 * ein zweiter Versuch mit demselben Schluessel INNERHALB derselben Org (z. B. der
 * naechste Job-Lauf fuer dieselbe ueberfaellige Rechnung) erzeugt KEINEN zweiten Eintrag
 * und wirft auch keinen Fehler (analog dem Dedup-Muster in `src/domain/attachment/
 * manage.ts`, addAttachment).
 */
import { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import type { NotificationType } from "@/domain/notifications/settings";

export interface CreateNotificationInput {
  orgId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
  at?: Date;
}

/** Legt eine Benachrichtigung an; liefert `null`, wenn `dedupeKey` bereits existiert. */
export async function createNotification(input: CreateNotificationInput): Promise<{ id: string } | null> {
  try {
    const row = await dbInternal.notification.create({
      data: {
        orgId: input.orgId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        createdAt: input.at ?? new Date(),
        dedupeKey: input.dedupeKey,
      },
      select: { id: true },
    });
    return row;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return null; // bereits vorhanden (Dedupe) — kein Fehler, kein zweiter Eintrag.
    }
    throw e;
  }
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
  readAt: Date | null;
}

/** Listet Benachrichtigungen einer Organisation, neueste zuerst. */
export async function listNotifications(orgId: string, opts: ListNotificationsOptions = {}): Promise<NotificationRow[]> {
  return dbInternal.notification.findMany({
    where: { orgId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
  });
}

/** Anzahl ungelesener Benachrichtigungen einer Organisation. */
export async function unreadCount(orgId: string): Promise<number> {
  return dbInternal.notification.count({ where: { orgId, readAt: null } });
}

export interface MarkReadInput {
  ids?: string[];
  all?: boolean;
}

/** Markiert einzelne (`ids`) oder alle (`all: true`) Benachrichtigungen einer Organisation als gelesen. */
export async function markRead(orgId: string, input: MarkReadInput): Promise<number> {
  const now = new Date();
  if (input.all) {
    const res = await dbInternal.notification.updateMany({ where: { orgId, readAt: null }, data: { readAt: now } });
    return res.count;
  }
  const ids = input.ids ?? [];
  if (ids.length === 0) return 0;
  const res = await dbInternal.notification.updateMany({ where: { orgId, id: { in: ids }, readAt: null }, data: { readAt: now } });
  return res.count;
}
