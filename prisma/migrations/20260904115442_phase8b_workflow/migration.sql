-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "note" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecurringInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "interval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "anchorDay" INTEGER,
    "startDate" DATETIME NOT NULL,
    "nextRunDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "maxRuns" INTEGER,
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "autoFinalize" BOOLEAN NOT NULL DEFAULT false,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "emailTemplateId" TEXT,
    "showPeriodText" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringInvoice_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RecurringInvoice" ("anchorDay", "autoFinalize", "autoSend", "createdAt", "currency", "customerId", "endDate", "id", "interval", "intervalCount", "issuedCount", "lastRunAt", "nextRunDate", "notes", "orgId", "paymentTermsDays", "startDate", "status", "taxScheme", "title", "updatedAt") SELECT "anchorDay", "autoFinalize", "autoSend", "createdAt", "currency", "customerId", "endDate", "id", "interval", "intervalCount", "issuedCount", "lastRunAt", "nextRunDate", "notes", "orgId", "paymentTermsDays", "startDate", "status", "taxScheme", "title", "updatedAt" FROM "RecurringInvoice";
DROP TABLE "RecurringInvoice";
ALTER TABLE "new_RecurringInvoice" RENAME TO "RecurringInvoice";
CREATE INDEX "RecurringInvoice_orgId_idx" ON "RecurringInvoice"("orgId");
CREATE INDEX "RecurringInvoice_customerId_idx" ON "RecurringInvoice"("customerId");
CREATE INDEX "RecurringInvoice_status_nextRunDate_idx" ON "RecurringInvoice"("status", "nextRunDate");
CREATE INDEX "RecurringInvoice_emailTemplateId_idx" ON "RecurringInvoice"("emailTemplateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
