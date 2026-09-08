/**
 * Fix-Welle Phase 8b (final-review-findings.md S4) — die drei ereignisgetriebenen
 * Benachrichtigungs-Hooks (onRecurringFailed/onEInvoiceInvalid/onEmailBounced) pruefen
 * jetzt `enabledTypes` (vorher nur `job.ts`, die Hooks ignorierten die Einstellungen-Seite
 * komplett — Abschalten hatte keine Wirkung).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { onRecurringFailed, onEInvoiceInvalid, onEmailBounced } from "@/domain/notifications/hooks";
import { saveNotificationSettings, ALL_NOTIFICATION_TYPES } from "@/domain/notifications/settings";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "S4 Fix-Welle GmbH", addressLine1: "S4weg 1", postalCode: "10115", city: "Berlin" },
  });
  orgId = org.id;
});

describe("S4: Hooks respektieren enabledTypes (vorher wirkungslos)", () => {
  it("onRecurringFailed erzeugt KEINE Benachrichtigung, wenn RECURRING_FAILED deaktiviert ist", async () => {
    await saveNotificationSettings(orgId, { enabledTypes: ALL_NOTIFICATION_TYPES.filter((t) => t !== "RECURRING_FAILED"), emailDigest: false });
    await onRecurringFailed(orgId, { recurringId: "rec-s4-1", title: "Testabo", message: "kaputt", at: new Date() });
    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "RECURRING_FAILED", entityId: "rec-s4-1" } });
    expect(notif).toBeNull();
  });

  it("onRecurringFailed erzeugt eine Benachrichtigung, wenn RECURRING_FAILED aktiviert ist", async () => {
    await saveNotificationSettings(orgId, { enabledTypes: [...ALL_NOTIFICATION_TYPES], emailDigest: false });
    await onRecurringFailed(orgId, { recurringId: "rec-s4-2", title: "Testabo 2", message: "kaputt", at: new Date() });
    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "RECURRING_FAILED", entityId: "rec-s4-2" } });
    expect(notif).not.toBeNull();
  });

  it("onEInvoiceInvalid erzeugt KEINE Benachrichtigung, wenn EINVOICE_INVALID deaktiviert ist", async () => {
    await saveNotificationSettings(orgId, { enabledTypes: ALL_NOTIFICATION_TYPES.filter((t) => t !== "EINVOICE_INVALID"), emailDigest: false });
    await onEInvoiceInvalid(orgId, { invoiceId: "inv-s4-1", errors: ["BR-01 fehlt"] });
    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "EINVOICE_INVALID", entityId: "inv-s4-1" } });
    expect(notif).toBeNull();
  });

  it("onEInvoiceInvalid erzeugt eine Benachrichtigung, wenn EINVOICE_INVALID aktiviert ist", async () => {
    await saveNotificationSettings(orgId, { enabledTypes: [...ALL_NOTIFICATION_TYPES], emailDigest: false });
    await onEInvoiceInvalid(orgId, { invoiceId: "inv-s4-2", errors: ["BR-01 fehlt"] });
    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "EINVOICE_INVALID", entityId: "inv-s4-2" } });
    expect(notif).not.toBeNull();
  });

  it("onEmailBounced erzeugt KEINE Benachrichtigung, wenn EMAIL_BOUNCED deaktiviert ist", async () => {
    await saveNotificationSettings(orgId, { enabledTypes: ALL_NOTIFICATION_TYPES.filter((t) => t !== "EMAIL_BOUNCED"), emailDigest: false });
    await onEmailBounced(orgId, { logId: "log-s4-1", docType: "INVOICE", docId: "inv-s4-3" });
    const notif = await dbInternal.notification.findFirst({ where: { orgId, type: "EMAIL_BOUNCED", entityId: "inv-s4-3" } });
    expect(notif).toBeNull();
  });
});
