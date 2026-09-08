-- Fix-Welle Phase 10 (Should-fix 7): der Scheduler-Job "webhooks" filtert auf
-- status + nextAttemptAt ohne orgId-Praedikat (WebhookDelivery.findMany in
-- src/domain/webhook/deliver.ts#runWebhookDeliveries) -- der bestehende Index
-- (orgId, status, nextAttemptAt) kann dafuer die fuehrende Spalte nicht nutzen.
-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
