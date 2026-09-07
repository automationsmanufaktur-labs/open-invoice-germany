-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "skontoForPaymentId" TEXT;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN "bankBic" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "bankIban" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "bankName" TEXT;

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
    "xmlFormat" TEXT,
    "xmlHash" TEXT,
    "pdfPath" TEXT,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "issueDate", "netTotalCents", "notes", "number", "orgId", "paidAmountCents", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "snapshotAt", "snapshotSource", "status", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash") SELECT "buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "issueDate", "netTotalCents", "notes", "number", "orgId", "paidAmountCents", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "snapshotAt", "snapshotSource", "status", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_orgId_idx" ON "Invoice"("orgId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");
CREATE INDEX "Invoice_paymentMethodId_idx" ON "Invoice"("paymentMethodId");
CREATE TABLE "new_InvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "unitNetPriceCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'S',
    "discountPermille" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "lineNetCents" INTEGER NOT NULL,
    CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InvoiceLine" ("description", "discountPermille", "id", "invoiceId", "lineNetCents", "position", "productId", "quantityMilli", "taxCategory", "taxRate", "unit", "unitNetPriceCents") SELECT "description", "discountPermille", "id", "invoiceId", "lineNetCents", "position", "productId", "quantityMilli", "taxCategory", "taxRate", "unit", "unitNetPriceCents" FROM "InvoiceLine";
DROP TABLE "InvoiceLine";
ALTER TABLE "new_InvoiceLine" RENAME TO "InvoiceLine";
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
CREATE TABLE "new_Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ANGEBOT',
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "subject" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "headerText" TEXT,
    "footerText" TEXT,
    "deliveryTerms" TEXT,
    "paymentTerms" TEXT,
    "customerReference" TEXT,
    "contactPersonId" TEXT,
    "billingAddressId" TEXT,
    "documentDiscountPermille" INTEGER NOT NULL DEFAULT 0,
    "documentDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "documentChargePermille" INTEGER NOT NULL DEFAULT 0,
    "documentChargeCents" INTEGER NOT NULL DEFAULT 0,
    "documentChargeReason" TEXT,
    "sellerSnapshotJson" TEXT,
    "buyerSnapshotJson" TEXT,
    "snapshotSource" TEXT,
    "snapshotAt" DATETIME,
    "netTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "grossTotalCents" INTEGER NOT NULL DEFAULT 0,
    "convertedToInvoiceId" TEXT,
    "sentAt" DATETIME,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Quote_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Quote" ("archivedAt", "billingAddressId", "buyerSnapshotJson", "contactPersonId", "convertedToInvoiceId", "createdAt", "currency", "customerId", "customerReference", "decidedAt", "decisionNote", "deliveryTerms", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "issueDate", "kind", "netTotalCents", "notes", "number", "orgId", "paymentTerms", "sellerSnapshotJson", "sentAt", "snapshotAt", "snapshotSource", "status", "subject", "taxScheme", "taxTotalCents", "updatedAt", "validUntil") SELECT "archivedAt", "billingAddressId", "buyerSnapshotJson", "contactPersonId", "convertedToInvoiceId", "createdAt", "currency", "customerId", "customerReference", "decidedAt", "decisionNote", "deliveryTerms", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "issueDate", "kind", "netTotalCents", "notes", "number", "orgId", "paymentTerms", "sellerSnapshotJson", "sentAt", "snapshotAt", "snapshotSource", "status", "subject", "taxScheme", "taxTotalCents", "updatedAt", "validUntil" FROM "Quote";
DROP TABLE "Quote";
ALTER TABLE "new_Quote" RENAME TO "Quote";
CREATE INDEX "Quote_orgId_idx" ON "Quote"("orgId");
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");
CREATE INDEX "Quote_contactPersonId_idx" ON "Quote"("contactPersonId");
CREATE INDEX "Quote_billingAddressId_idx" ON "Quote"("billingAddressId");
CREATE TABLE "new_QuoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "unitNetPriceCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'S',
    "discountPermille" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "lineNetCents" INTEGER NOT NULL,
    CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuoteLine" ("description", "discountPermille", "id", "lineNetCents", "position", "quantityMilli", "quoteId", "taxCategory", "taxRate", "unit", "unitNetPriceCents") SELECT "description", "discountPermille", "id", "lineNetCents", "position", "quantityMilli", "quoteId", "taxCategory", "taxRate", "unit", "unitNetPriceCents" FROM "QuoteLine";
DROP TABLE "QuoteLine";
ALTER TABLE "new_QuoteLine" RENAME TO "QuoteLine";
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill (SQLite): Systemzahlungsmethode SKONTO je Organisation nachziehen
-- (Muster Phase-1-Backfill, src/domain/masterdata/defaults.ts SYSTEM_PAYMENT_METHODS).
INSERT INTO "PaymentMethod" ("id","orgId","code","name","untdidCode","isSystem","isActive","sortOrder","createdAt","updatedAt")
SELECT 'pm_' || o."id" || '_SKONTO', o."id", 'SKONTO', 'Skonto', 'ZZZ', 1, 1, 9,
       CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" p WHERE p."orgId" = o."id" AND p."code" = 'SKONTO');
