-- AlterTable
ALTER TABLE "Dunning" ADD COLUMN     "buyerSnapshotJson" TEXT,
ADD COLUMN     "claimBaseCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdBy" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "feeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceDueDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "sellerSnapshotJson" TEXT,
ADD COLUMN     "snapshotSource" TEXT;

-- AlterTable
ALTER TABLE "DunningStage" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dunningPausedUntil" TIMESTAMP(3),
ADD COLUMN     "dunningState" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "dunningStateNote" TEXT;

-- CreateTable
CREATE TABLE "DunningSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "autoCreate" BOOLEAN NOT NULL DEFAULT true,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "baseInterestRateBp" INTEGER NOT NULL DEFAULT 127,
    "baseRateValidFrom" TIMESTAMP(3),
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summaryJson" TEXT,
    "error" TEXT,

    CONSTRAINT "SchedulerRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DunningSettings_orgId_key" ON "DunningSettings"("orgId");

-- CreateIndex
CREATE INDEX "SchedulerRun_job_startedAt_idx" ON "SchedulerRun"("job", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dunning_invoiceId_stageId_key" ON "Dunning"("invoiceId", "stageId");

-- AddForeignKey
ALTER TABLE "DunningSettings" ADD CONSTRAINT "DunningSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

