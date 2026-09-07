-- Fix-Welle Phase 8b (final-review-findings.md S3 + Nit dedupeKey) — siehe SQLite-Migration
-- 20260904140000_phase8b_fixwave fuer die ausfuehrliche Begruendung.
UPDATE "RecurringInvoice" r
SET "showPeriodText" = COALESCE(
  (SELECT ds."recurringInsertPeriodText" FROM "DocumentSettings" ds WHERE ds."orgId" = r."orgId"),
  true
);

DROP INDEX "Notification_dedupeKey_key";
CREATE UNIQUE INDEX "Notification_orgId_dedupeKey_key" ON "Notification"("orgId", "dedupeKey");
