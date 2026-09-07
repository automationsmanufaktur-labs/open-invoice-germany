-- AlterTable
ALTER TABLE "ApiIdempotency" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
ALTER COLUMN "responseJson" DROP NOT NULL,
ALTER COLUMN "statusCode" DROP NOT NULL;

-- Bestandsdaten (Task 1, vor Fix-Runde 1) hatten IMMER eine gespeicherte Antwort
-- (responseJson war NOT NULL) -> als DONE markieren statt beim Default IN_PROGRESS
-- zu bleiben (sonst wuerden alte, laengst abgeschlossene Idempotency-Keys faelschlich
-- als "wird gerade verarbeitet" gelten).
UPDATE "ApiIdempotency" SET "status" = 'DONE' WHERE "responseJson" IS NOT NULL;
