-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "defaultPaymentTermsDays" DROP NOT NULL,
ALTER COLUMN "defaultPaymentTermsDays" DROP DEFAULT;

-- Backfill (S1, Betreiberentscheidung analog Alt-Belege-Snapshots): siehe SQLite-Migration
-- fuer die vollstaendige Begruendung. NULL = kein Kunden-Override.
UPDATE "Customer" SET "defaultPaymentTermsDays" = NULL WHERE "defaultPaymentTermsDays" = 14;
