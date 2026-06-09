-- Wiederkehrende Rechnungen / Abos
CREATE TABLE "RecurringInvoice" (
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
    "lastRunAt" DATETIME,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RecurringInvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recurringInvoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "unitNetPriceCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'S',
    "discountPermille" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RecurringInvoiceLine_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Herkunfts-Verknüpfung der erzeugten Rechnungen
ALTER TABLE "Invoice" ADD COLUMN "recurringInvoiceId" TEXT;

CREATE INDEX "RecurringInvoice_orgId_idx" ON "RecurringInvoice"("orgId");
CREATE INDEX "RecurringInvoice_customerId_idx" ON "RecurringInvoice"("customerId");
CREATE INDEX "RecurringInvoice_status_nextRunDate_idx" ON "RecurringInvoice"("status", "nextRunDate");
CREATE INDEX "RecurringInvoiceLine_recurringInvoiceId_idx" ON "RecurringInvoiceLine"("recurringInvoiceId");
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");
