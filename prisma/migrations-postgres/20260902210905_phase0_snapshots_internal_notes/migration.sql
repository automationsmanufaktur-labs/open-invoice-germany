-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyerSnapshotJson" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "sellerSnapshotJson" TEXT,
ADD COLUMN     "snapshotAt" TIMESTAMP(3),
ADD COLUMN     "snapshotSource" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "buyerSnapshotJson" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "sellerSnapshotJson" TEXT,
ADD COLUMN     "snapshotAt" TIMESTAMP(3),
ADD COLUMN     "snapshotSource" TEXT;
