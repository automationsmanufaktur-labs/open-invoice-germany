-- CreateTable
CREATE TABLE "DunningSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "autoCreate" BOOLEAN NOT NULL DEFAULT true,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "baseInterestRateBp" INTEGER NOT NULL DEFAULT 127,
    "baseRateValidFrom" DATETIME,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DunningSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "summaryJson" TEXT,
    "error" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dunning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "number" TEXT,
    "level" INTEGER NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME,
    "baseInterestRatePermille" INTEGER,
    "interestRatePoints" INTEGER,
    "interestAmountCents" INTEGER NOT NULL DEFAULT 0,
    "lateFeeCents" INTEGER NOT NULL DEFAULT 0,
    "flatFee40Cents" INTEGER NOT NULL DEFAULT 0,
    "pdfPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sellerSnapshotJson" TEXT,
    "buyerSnapshotJson" TEXT,
    "snapshotSource" TEXT,
    "claimBaseCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "invoiceNumber" TEXT,
    "invoiceDueDate" DATETIME,
    "createdBy" TEXT NOT NULL DEFAULT 'user',
    "stageId" TEXT,
    CONSTRAINT "Dunning_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Dunning_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "DunningStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Dunning" ("baseInterestRatePermille", "createdAt", "dueDate", "flatFee40Cents", "id", "interestAmountCents", "interestRatePoints", "invoiceId", "lateFeeCents", "level", "number", "pdfPath", "sentAt", "stageId") SELECT "baseInterestRatePermille", "createdAt", "dueDate", "flatFee40Cents", "id", "interestAmountCents", "interestRatePoints", "invoiceId", "lateFeeCents", "level", "number", "pdfPath", "sentAt", "stageId" FROM "Dunning";
DROP TABLE "Dunning";
ALTER TABLE "new_Dunning" RENAME TO "Dunning";
CREATE INDEX "Dunning_invoiceId_idx" ON "Dunning"("invoiceId");
CREATE UNIQUE INDEX "Dunning_invoiceId_stageId_key" ON "Dunning"("invoiceId", "stageId");
CREATE TABLE "new_DunningStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "daysAfterDue" INTEGER NOT NULL,
    "newDueDays" INTEGER NOT NULL DEFAULT 14,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "calculateInterest" BOOLEAN NOT NULL,
    "includeB2BFlatFee" BOOLEAN NOT NULL,
    "emailTemplateId" TEXT,
    "documentTemplateId" TEXT,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DunningStage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DunningStage_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DunningStage" ("calculateInterest", "createdAt", "daysAfterDue", "documentTemplateId", "emailTemplateId", "enabled", "feeCents", "id", "includeB2BFlatFee", "name", "newDueDays", "order", "orgId", "updatedAt") SELECT "calculateInterest", "createdAt", "daysAfterDue", "documentTemplateId", "emailTemplateId", "enabled", "feeCents", "id", "includeB2BFlatFee", "name", "newDueDays", "order", "orgId", "updatedAt" FROM "DunningStage";
DROP TABLE "DunningStage";
ALTER TABLE "new_DunningStage" RENAME TO "DunningStage";
CREATE INDEX "DunningStage_orgId_idx" ON "DunningStage"("orgId");
CREATE UNIQUE INDEX "DunningStage_orgId_order_key" ON "DunningStage"("orgId", "order");
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "type" TEXT NOT NULL DEFAULT 'INVOICE',
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" DATETIME,
    "deliveryStart" DATETIME,
    "deliveryEnd" DATETIME,
    "dueDate" DATETIME,
    "buyerReference" TEXT,
    "subject" TEXT,
    "orderNumber" TEXT,
    "internalReference" TEXT,
    "contactPersonId" TEXT,
    "billingAddressId" TEXT,
    "shippingAddressId" TEXT,
    "notes" TEXT,
    "paymentTerms" TEXT,
    "internalNotes" TEXT,
    "headerText" TEXT,
    "footerText" TEXT,
    "documentDiscountPermille" INTEGER NOT NULL DEFAULT 0,
    "documentDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "documentChargePermille" INTEGER NOT NULL DEFAULT 0,
    "documentChargeCents" INTEGER NOT NULL DEFAULT 0,
    "documentChargeReason" TEXT,
    "skonto1Permille" INTEGER,
    "skonto1Days" INTEGER,
    "skonto2Permille" INTEGER,
    "skonto2Days" INTEGER,
    "paymentMethodId" TEXT,
    "paymentMethodSnapshotJson" TEXT,
    "sellerSnapshotJson" TEXT,
    "buyerSnapshotJson" TEXT,
    "snapshotSource" TEXT,
    "snapshotAt" DATETIME,
    "netTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "grossTotalCents" INTEGER NOT NULL DEFAULT 0,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "taxBreakdownJson" TEXT NOT NULL DEFAULT '[]',
    "consumerRetentionHint" BOOLEAN NOT NULL DEFAULT false,
    "reversedByInvoiceId" TEXT,
    "correctsInvoiceId" TEXT,
    "recurringInvoiceId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "partialPermille" INTEGER,
    "prepaidCents" INTEGER NOT NULL DEFAULT 0,
    "payableCents" INTEGER,
    "xmlFormat" TEXT,
    "xmlHash" TEXT,
    "pdfPath" TEXT,
    "finalizedAt" DATETIME,
    "dunningState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dunningPausedUntil" DATETIME,
    "dunningStateNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("billingAddressId", "buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "contactPersonId", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "documentChargeCents", "documentChargePermille", "documentChargeReason", "documentDiscountCents", "documentDiscountPermille", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "internalReference", "issueDate", "netTotalCents", "notes", "number", "orderNumber", "orgId", "paidAmountCents", "partialPermille", "payableCents", "paymentMethodId", "paymentMethodSnapshotJson", "paymentTerms", "pdfPath", "prepaidCents", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "shippingAddressId", "skonto1Days", "skonto1Permille", "skonto2Days", "skonto2Permille", "snapshotAt", "snapshotSource", "sourceId", "sourceType", "status", "subject", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash") SELECT "billingAddressId", "buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "contactPersonId", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "documentChargeCents", "documentChargePermille", "documentChargeReason", "documentDiscountCents", "documentDiscountPermille", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "internalReference", "issueDate", "netTotalCents", "notes", "number", "orderNumber", "orgId", "paidAmountCents", "partialPermille", "payableCents", "paymentMethodId", "paymentMethodSnapshotJson", "paymentTerms", "pdfPath", "prepaidCents", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "shippingAddressId", "skonto1Days", "skonto1Permille", "skonto2Days", "skonto2Permille", "snapshotAt", "snapshotSource", "sourceId", "sourceType", "status", "subject", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_orgId_idx" ON "Invoice"("orgId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");
CREATE INDEX "Invoice_paymentMethodId_idx" ON "Invoice"("paymentMethodId");
CREATE INDEX "Invoice_contactPersonId_idx" ON "Invoice"("contactPersonId");
CREATE INDEX "Invoice_billingAddressId_idx" ON "Invoice"("billingAddressId");
CREATE INDEX "Invoice_shippingAddressId_idx" ON "Invoice"("shippingAddressId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DunningSettings_orgId_key" ON "DunningSettings"("orgId");

-- CreateIndex
CREATE INDEX "SchedulerRun_job_startedAt_idx" ON "SchedulerRun"("job", "startedAt");
