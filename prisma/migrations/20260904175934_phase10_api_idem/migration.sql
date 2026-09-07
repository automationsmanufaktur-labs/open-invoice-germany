-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiIdempotency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "responseJson" TEXT,
    "statusCode" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ApiIdempotency" ("createdAt", "id", "key", "orgId", "requestHash", "responseJson", "statusCode") SELECT "createdAt", "id", "key", "orgId", "requestHash", "responseJson", "statusCode" FROM "ApiIdempotency";
DROP TABLE "ApiIdempotency";
ALTER TABLE "new_ApiIdempotency" RENAME TO "ApiIdempotency";
CREATE INDEX "ApiIdempotency_orgId_createdAt_idx" ON "ApiIdempotency"("orgId", "createdAt");
CREATE UNIQUE INDEX "ApiIdempotency_orgId_key_key" ON "ApiIdempotency"("orgId", "key");

-- Bestandsdaten (Task 1, vor Fix-Runde 1) hatten IMMER eine gespeicherte Antwort
-- (responseJson war NOT NULL) -> als DONE markieren statt beim Default IN_PROGRESS
-- zu bleiben (sonst wuerden alte, laengst abgeschlossene Idempotency-Keys faelschlich
-- als "wird gerade verarbeitet" gelten).
UPDATE "ApiIdempotency" SET "status" = 'DONE' WHERE "responseJson" IS NOT NULL;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
