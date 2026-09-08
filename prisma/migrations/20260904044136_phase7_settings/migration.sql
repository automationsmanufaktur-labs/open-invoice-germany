-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "customerNumber" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "printOptionsJson" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "printOptionsJson" TEXT;

-- CreateTable
CREATE TABLE "BrandingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "logoPath" TEXT,
    "logoWidthMm" INTEGER NOT NULL DEFAULT 40,
    "primaryColor" TEXT NOT NULL DEFAULT '#111111',
    "senderLine" TEXT,
    "footerLeft" TEXT,
    "footerCenter" TEXT,
    "footerRight" TEXT,
    "marginTopMm" INTEGER NOT NULL DEFAULT 20,
    "marginRightMm" INTEGER NOT NULL DEFAULT 18,
    "marginBottomMm" INTEGER NOT NULL DEFAULT 20,
    "marginLeftMm" INTEGER NOT NULL DEFAULT 18,
    "fontSizePt" INTEGER NOT NULL DEFAULT 10,
    "backgroundPath" TEXT,
    "showBackground" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandingSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "showFooter" BOOLEAN NOT NULL DEFAULT true,
    "showPageNumbers" BOOLEAN NOT NULL DEFAULT true,
    "foldMarks" BOOLEAN NOT NULL DEFAULT false,
    "punchMarks" BOOLEAN NOT NULL DEFAULT false,
    "showArticleNumber" BOOLEAN NOT NULL DEFAULT true,
    "showDescription" BOOLEAN NOT NULL DEFAULT true,
    "showTaxRatePerLine" BOOLEAN NOT NULL DEFAULT true,
    "showLineTotals" BOOLEAN NOT NULL DEFAULT true,
    "showSenderLine" BOOLEAN NOT NULL DEFAULT true,
    "showGiroCode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PrintSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeliveryNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" DATETIME,
    "shippingDate" DATETIME,
    "showPrices" BOOLEAN NOT NULL DEFAULT false,
    "showTax" BOOLEAN NOT NULL DEFAULT false,
    "showArticleNumber" BOOLEAN NOT NULL DEFAULT true,
    "showDescription" BOOLEAN NOT NULL DEFAULT true,
    "showDeliveryAddress" BOOLEAN NOT NULL DEFAULT true,
    "printOptionsJson" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "headerText" TEXT,
    "footerText" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sellerSnapshotJson" TEXT,
    "buyerSnapshotJson" TEXT,
    "snapshotSource" TEXT,
    "snapshotAt" DATETIME,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryNote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DeliveryNote" ("archivedAt", "buyerSnapshotJson", "createdAt", "customerId", "deliveredAt", "deliveryDate", "footerText", "headerText", "id", "internalNotes", "issueDate", "notes", "number", "orgId", "sellerSnapshotJson", "sentAt", "shippingDate", "showArticleNumber", "showDescription", "showPrices", "showTax", "snapshotAt", "snapshotSource", "sourceId", "sourceType", "status", "updatedAt") SELECT "archivedAt", "buyerSnapshotJson", "createdAt", "customerId", "deliveredAt", "deliveryDate", "footerText", "headerText", "id", "internalNotes", "issueDate", "notes", "number", "orgId", "sellerSnapshotJson", "sentAt", "shippingDate", "showArticleNumber", "showDescription", "showPrices", "showTax", "snapshotAt", "snapshotSource", "sourceId", "sourceType", "status", "updatedAt" FROM "DeliveryNote";
DROP TABLE "DeliveryNote";
ALTER TABLE "new_DeliveryNote" RENAME TO "DeliveryNote";
CREATE INDEX "DeliveryNote_orgId_idx" ON "DeliveryNote"("orgId");
CREATE INDEX "DeliveryNote_customerId_idx" ON "DeliveryNote"("customerId");
CREATE TABLE "new_DocumentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "onQuoteAccept" TEXT NOT NULL DEFAULT 'NONE',
    "shareLinkDays" INTEGER NOT NULL DEFAULT 30,
    "storeAcceptIp" BOOLEAN NOT NULL DEFAULT false,
    "autoFinalizeOnSend" BOOLEAN NOT NULL DEFAULT false,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
    "shareLinkDefaultOn" BOOLEAN NOT NULL DEFAULT true,
    "dnShowPrices" BOOLEAN NOT NULL DEFAULT false,
    "dnShowArticleNumber" BOOLEAN NOT NULL DEFAULT true,
    "dnShowDeliveryAddress" BOOLEAN NOT NULL DEFAULT true,
    "invoiceDueDays" INTEGER NOT NULL DEFAULT 14,
    "showPaymentTermsText" BOOLEAN NOT NULL DEFAULT true,
    "autoDeliveryDate" BOOLEAN NOT NULL DEFAULT true,
    "refreshIssueDateOnFinalize" BOOLEAN NOT NULL DEFAULT true,
    "offerLastDocument" BOOLEAN NOT NULL DEFAULT true,
    "eInvoiceDefault" BOOLEAN NOT NULL DEFAULT true,
    "defaultPaymentMethodId" TEXT,
    "recurringInsertPeriodText" BOOLEAN NOT NULL DEFAULT true,
    "recurringAutoFinalizeDefault" BOOLEAN NOT NULL DEFAULT false,
    "recurringAutoSendDefault" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocumentSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DocumentSettings" ("id", "onQuoteAccept", "orgId", "shareLinkDays", "storeAcceptIp", "updatedAt") SELECT "id", "onQuoteAccept", "orgId", "shareLinkDays", "storeAcceptIp", "updatedAt" FROM "DocumentSettings";
DROP TABLE "DocumentSettings";
ALTER TABLE "new_DocumentSettings" RENAME TO "DocumentSettings";
CREATE UNIQUE INDEX "DocumentSettings_orgId_key" ON "DocumentSettings"("orgId");
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
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "autoFinalize" BOOLEAN NOT NULL DEFAULT false,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" DATETIME,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RecurringInvoice" ("anchorDay", "autoFinalize", "createdAt", "currency", "customerId", "endDate", "id", "interval", "intervalCount", "issuedCount", "lastRunAt", "nextRunDate", "notes", "orgId", "paymentTermsDays", "startDate", "status", "taxScheme", "title", "updatedAt") SELECT "anchorDay", "autoFinalize", "createdAt", "currency", "customerId", "endDate", "id", "interval", "intervalCount", "issuedCount", "lastRunAt", "nextRunDate", "notes", "orgId", "paymentTermsDays", "startDate", "status", "taxScheme", "title", "updatedAt" FROM "RecurringInvoice";
DROP TABLE "RecurringInvoice";
ALTER TABLE "new_RecurringInvoice" RENAME TO "RecurringInvoice";
CREATE INDEX "RecurringInvoice_orgId_idx" ON "RecurringInvoice"("orgId");
CREATE INDEX "RecurringInvoice_customerId_idx" ON "RecurringInvoice"("customerId");
CREATE INDEX "RecurringInvoice_status_nextRunDate_idx" ON "RecurringInvoice"("status", "nextRunDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BrandingSettings_orgId_key" ON "BrandingSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintSettings_orgId_key" ON "PrintSettings"("orgId");

-- CreateIndex
CREATE INDEX "Customer_orgId_customerNumber_idx" ON "Customer"("orgId", "customerNumber");
