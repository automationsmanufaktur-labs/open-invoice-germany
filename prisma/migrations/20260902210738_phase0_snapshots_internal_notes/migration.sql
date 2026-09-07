-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "buyerSnapshotJson" TEXT;
ALTER TABLE "Quote" ADD COLUMN "internalNotes" TEXT;
ALTER TABLE "Quote" ADD COLUMN "sellerSnapshotJson" TEXT;
ALTER TABLE "Quote" ADD COLUMN "snapshotAt" DATETIME;
ALTER TABLE "Quote" ADD COLUMN "snapshotSource" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "notes" TEXT,
    "paymentTerms" TEXT,
    "internalNotes" TEXT,
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
    "xmlFormat" TEXT,
    "xmlHash" TEXT,
    "pdfPath" TEXT,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("buyerReference", "consumerRetentionHint", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "dueDate", "finalizedAt", "grossTotalCents", "id", "issueDate", "netTotalCents", "notes", "number", "orgId", "paidAmountCents", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "status", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash") SELECT "buyerReference", "consumerRetentionHint", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "dueDate", "finalizedAt", "grossTotalCents", "id", "issueDate", "netTotalCents", "notes", "number", "orgId", "paidAmountCents", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "status", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_orgId_idx" ON "Invoice"("orgId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
