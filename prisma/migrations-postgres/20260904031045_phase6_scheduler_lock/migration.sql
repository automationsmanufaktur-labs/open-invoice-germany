-- CreateTable
CREATE TABLE "SchedulerLock" (
    "job" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulerLock_pkey" PRIMARY KEY ("job")
);

