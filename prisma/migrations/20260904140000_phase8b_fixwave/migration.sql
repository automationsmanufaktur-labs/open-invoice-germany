-- Fix-Welle Phase 8b (final-review-findings.md S3 + Nit dedupeKey).
--
-- S3: RecurringInvoice.showPeriodText wurde in Phase 8b mit Default `true` eingefuehrt,
-- ohne bestehende Abos aus dem bisherigen Settings-Wert (DocumentSettings.
-- recurringInsertPeriodText) zu befuellen. Fuer ALLE bestehenden Zeilen (nicht nur
-- solche mit dem Default true) auf den Wert der jeweiligen Organisation ziehen — das
-- ist exakt das Verhalten, das run.ts vor dieser Phase hatte (Settings-Wert galt fuer
-- jeden Lauf), showPeriodText ersetzt es lediglich als Abo-Override ab jetzt.
UPDATE "RecurringInvoice"
SET "showPeriodText" = COALESCE(
  (SELECT "recurringInsertPeriodText" FROM "DocumentSettings" WHERE "DocumentSettings"."orgId" = "RecurringInvoice"."orgId"),
  true
);

-- Nit: Notification.dedupeKey war global @unique statt org-scoped — Cross-Tenant-Kopplung
-- in einem sonst strikt org-gescopten Modell. dedupeKeys sind bereits cuid-praefigiert
-- (siehe notifications/hooks.ts), daher keine Datenbereinigung noetig.
DROP INDEX "Notification_dedupeKey_key";
CREATE UNIQUE INDEX "Notification_orgId_dedupeKey_key" ON "Notification"("orgId", "dedupeKey");
