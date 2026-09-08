/**
 * Benachrichtigungs-Einstellungen je Organisation (Phase 8b, Task 3) — analog
 * `src/domain/dunning/settings.ts`: Selbstheilung PER CREATE, weil der Scheduler-Job
 * `notifications` (`job.ts`) beim Lauf eine tatsaechliche Zeile je Organisation braucht
 * (Digest-Zeitpunkt `lastDigestAt`), ein reiner In-Memory-Default reicht hier nicht.
 */
import { dbInternal } from "@/lib/db";

/** Benachrichtigungstypen (`Notification.type`) mit deutschem Anzeigetext (Task-3-Brief). */
export const NOTIFICATION_TYPES = {
  INVOICE_DUE_TODAY: "Rechnung heute faellig",
  INVOICE_OVERDUE: "Rechnung ueberfaellig",
  DUNNING_STAGE_REACHED: "Mahnstufe faellig",
  QUOTE_EXPIRING: "Angebot laeuft bald ab",
  EMAIL_BOUNCED: "E-Mail unzustellbar",
  RECURRING_FAILED: "Wiederkehrende Rechnung fehlgeschlagen",
  EINVOICE_INVALID: "E-Rechnung ungueltig",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const ALL_NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export interface NotificationSettingsValue {
  enabledTypes: NotificationType[];
  emailDigest: boolean;
  lastDigestAt: Date | null;
}

function parseEnabledTypes(json: string): NotificationType[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [...ALL_NOTIFICATION_TYPES];
    return parsed.filter((t): t is NotificationType => ALL_NOTIFICATION_TYPES.includes(t));
  } catch {
    return [...ALL_NOTIFICATION_TYPES];
  }
}

/**
 * Laedt die Benachrichtigungs-Einstellungen einer Organisation; legt sie mit Defaults
 * (alle Typen aktiv, Digest aus) an, wenn noch keine Zeile existiert (Selbstheilung,
 * upsert statt find+create wegen Nebenlaeufigkeit).
 */
export async function loadNotificationSettings(orgId: string): Promise<NotificationSettingsValue> {
  const existing = await dbInternal.notificationSettings.findUnique({ where: { orgId } });
  if (existing) {
    return { enabledTypes: parseEnabledTypes(existing.enabledTypesJson), emailDigest: existing.emailDigest, lastDigestAt: existing.lastDigestAt };
  }
  const row = await dbInternal.notificationSettings.upsert({
    where: { orgId },
    create: { orgId, enabledTypesJson: JSON.stringify(ALL_NOTIFICATION_TYPES), emailDigest: false },
    update: {},
  });
  return { enabledTypes: parseEnabledTypes(row.enabledTypesJson), emailDigest: row.emailDigest, lastDigestAt: row.lastDigestAt };
}

export interface SaveNotificationSettingsInput {
  enabledTypes: NotificationType[];
  emailDigest: boolean;
}

/** Speichert die Benachrichtigungs-Einstellungen (Upsert, da anfangs keine Zeile existiert). */
export async function saveNotificationSettings(orgId: string, input: SaveNotificationSettingsInput): Promise<NotificationSettingsValue> {
  const enabledTypesJson = JSON.stringify(input.enabledTypes.filter((t) => ALL_NOTIFICATION_TYPES.includes(t)));
  const row = await dbInternal.notificationSettings.upsert({
    where: { orgId },
    create: { orgId, enabledTypesJson, emailDigest: input.emailDigest },
    update: { enabledTypesJson, emailDigest: input.emailDigest },
  });
  return { enabledTypes: parseEnabledTypes(row.enabledTypesJson), emailDigest: row.emailDigest, lastDigestAt: row.lastDigestAt };
}

/** Setzt `lastDigestAt` nach einem erfolgreich versendeten Digest (job.ts). */
export async function markDigestSent(orgId: string, at: Date): Promise<void> {
  await dbInternal.notificationSettings.update({ where: { orgId }, data: { lastDigestAt: at } });
}
