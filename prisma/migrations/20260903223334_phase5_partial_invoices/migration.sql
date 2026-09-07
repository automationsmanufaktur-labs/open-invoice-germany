-- CreateTable
CREATE TABLE "FinalInvoiceDeduction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "finalInvoiceId" TEXT NOT NULL,
    "downpaymentInvoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "netCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinalInvoiceDeduction_finalInvoiceId_fkey" FOREIGN KEY ("finalInvoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinalInvoiceDeduction_downpaymentInvoiceId_fkey" FOREIGN KEY ("downpaymentInvoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "sourceType" TEXT,
    "sourceId" TEXT,
    "partialPermille" INTEGER,
    "prepaidCents" INTEGER NOT NULL DEFAULT 0,
    "payableCents" INTEGER,
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
INSERT INTO "new_Invoice" ("billingAddressId", "buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "contactPersonId", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "documentChargeCents", "documentChargePermille", "documentChargeReason", "documentDiscountCents", "documentDiscountPermille", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "internalReference", "issueDate", "netTotalCents", "notes", "number", "orderNumber", "orgId", "paidAmountCents", "paymentMethodId", "paymentMethodSnapshotJson", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "shippingAddressId", "skonto1Days", "skonto1Permille", "skonto2Days", "skonto2Permille", "snapshotAt", "snapshotSource", "status", "subject", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash") SELECT "billingAddressId", "buyerReference", "buyerSnapshotJson", "consumerRetentionHint", "contactPersonId", "correctsInvoiceId", "createdAt", "currency", "customerId", "deliveryDate", "deliveryEnd", "deliveryStart", "documentChargeCents", "documentChargePermille", "documentChargeReason", "documentDiscountCents", "documentDiscountPermille", "dueDate", "finalizedAt", "footerText", "grossTotalCents", "headerText", "id", "internalNotes", "internalReference", "issueDate", "netTotalCents", "notes", "number", "orderNumber", "orgId", "paidAmountCents", "paymentMethodId", "paymentMethodSnapshotJson", "paymentTerms", "pdfPath", "recurringInvoiceId", "reversedByInvoiceId", "sellerSnapshotJson", "shippingAddressId", "skonto1Days", "skonto1Permille", "skonto2Days", "skonto2Permille", "snapshotAt", "snapshotSource", "status", "subject", "taxBreakdownJson", "taxScheme", "taxTotalCents", "type", "updatedAt", "xmlFormat", "xmlHash" FROM "Invoice";
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
CREATE INDEX "FinalInvoiceDeduction_finalInvoiceId_idx" ON "FinalInvoiceDeduction"("finalInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalInvoiceDeduction_finalInvoiceId_downpaymentInvoiceId_taxRate_taxCategory_key" ON "FinalInvoiceDeduction"("finalInvoiceId", "downpaymentInvoiceId", "taxRate", "taxCategory");
