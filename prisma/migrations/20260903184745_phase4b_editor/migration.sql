-- AlterTable
ALTER TABLE "Product" ADD COLUMN "articleNumber" TEXT;

-- CreateTable
CREATE TABLE "DocumentAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentAttachment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "xmlFormat" TEXT,
    "xmlHash" TEXT,
    "pdfPath" TEXT,
    "finalizedAt" DATETIME,
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
INSERT INTO "new_Invoice" ("buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "documentChargeCents", "documentChargePermille", "documentChargeReason", "documentDiscountCents", "documentDiscountPermille", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "issueDate", "netTotalCents", "notes", "number", "orgId", "paidAmountCents", "paymentMethodId", "paymentMethodSnapshotJson", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "skonto1Days", "skonto1Permille", "skonto2Days", "skonto2Permille", "snapshotAt", "snapshotSource", "status", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash") SELECT "buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "documentChargeCents", "documentChargePermille", "documentChargeReason", "documentDiscountCents", "documentDiscountPermille", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "issueDate", "netTotalCents", "notes", "number", "orgId", "paidAmountCents", "paymentMethodId", "paymentMethodSnapshotJson", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "skonto1Days", "skonto1Permille", "skonto2Days", "skonto2Permille", "snapshotAt", "snapshotSource", "status", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash" FROM "Invoice";
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
CREATE TABLE "new_InvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "lineType" TEXT NOT NULL DEFAULT 'ITEM',
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "descriptionLong" TEXT,
    "articleNumber" TEXT,
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
INSERT INTO "new_InvoiceLine" ("description", "discountCents", "discountPermille", "id", "invoiceId", "lineNetCents", "position", "productId", "quantityMilli", "taxCategory", "taxRate", "unit", "unitNetPriceCents") SELECT "description", "discountCents", "discountPermille", "id", "invoiceId", "lineNetCents", "position", "productId", "quantityMilli", "taxCategory", "taxRate", "unit", "unitNetPriceCents" FROM "InvoiceLine";
DROP TABLE "InvoiceLine";
ALTER TABLE "new_InvoiceLine" RENAME TO "InvoiceLine";
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
CREATE TABLE "new_QuoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "lineType" TEXT NOT NULL DEFAULT 'ITEM',
    "description" TEXT NOT NULL,
    "descriptionLong" TEXT,
    "articleNumber" TEXT,
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
INSERT INTO "new_QuoteLine" ("description", "discountCents", "discountPermille", "id", "lineNetCents", "position", "quantityMilli", "quoteId", "taxCategory", "taxRate", "unit", "unitNetPriceCents") SELECT "description", "discountCents", "discountPermille", "id", "lineNetCents", "position", "quantityMilli", "quoteId", "taxCategory", "taxRate", "unit", "unitNetPriceCents" FROM "QuoteLine";
DROP TABLE "QuoteLine";
ALTER TABLE "new_QuoteLine" RENAME TO "QuoteLine";
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DocumentAttachment_orgId_docType_docId_idx" ON "DocumentAttachment"("orgId", "docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAttachment_orgId_sha256_docType_docId_key" ON "DocumentAttachment"("orgId", "sha256", "docType", "docId");

-- CreateIndex
CREATE INDEX "Product_orgId_articleNumber_idx" ON "Product"("orgId", "articleNumber");
