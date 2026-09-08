-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "contactSnapshotJson" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "contactSnapshotJson" TEXT;

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "optionsJson" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomFieldDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BUSINESS',
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'DE',
    "email" TEXT,
    "phone" TEXT,
    "vatId" TEXT,
    "vatIdValidatedAt" DATETIME,
    "leitwegId" TEXT,
    "peppolId" TEXT,
    "defaultPaymentTermsDays" INTEGER,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "customerNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "defaultPaymentMethodId" TEXT,
    "defaultCurrency" TEXT,
    "defaultDiscountPermille" INTEGER NOT NULL DEFAULT 0,
    "invoiceEmail" TEXT,
    "invoiceCc" TEXT,
    "quoteEmail" TEXT,
    "eInvoicePreferred" BOOLEAN NOT NULL DEFAULT false,
    "orderReference" TEXT,
    "deliveryTermsText" TEXT,
    "paymentTermsText" TEXT,
    "language" TEXT NOT NULL DEFAULT 'de',
    "customFieldsJson" TEXT,
    CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_defaultPaymentMethodId_fkey" FOREIGN KEY ("defaultPaymentMethodId") REFERENCES "PaymentMethod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("addressLine1", "addressLine2", "city", "contactName", "countryCode", "createdAt", "customerNumber", "defaultPaymentMethodId", "defaultPaymentTermsDays", "email", "id", "isArchived", "leitwegId", "name", "notes", "orgId", "peppolId", "phone", "postalCode", "type", "updatedAt", "vatId", "vatIdValidatedAt") SELECT "addressLine1", "addressLine2", "city", "contactName", "countryCode", "createdAt", "customerNumber", "defaultPaymentMethodId", "defaultPaymentTermsDays", "email", "id", "isArchived", "leitwegId", "name", "notes", "orgId", "peppolId", "phone", "postalCode", "type", "updatedAt", "vatId", "vatIdValidatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_orgId_idx" ON "Customer"("orgId");
CREATE INDEX "Customer_orgId_customerNumber_idx" ON "Customer"("orgId", "customerNumber");
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
    "shippingAddressId" TEXT,
    "contactPersonId" TEXT,
    "contactSnapshotJson" TEXT,
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
    CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeliveryNote_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeliveryNote_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DeliveryNote" ("archivedAt", "buyerSnapshotJson", "createdAt", "customerId", "deliveredAt", "deliveryDate", "footerText", "headerText", "id", "internalNotes", "issueDate", "notes", "number", "orgId", "printOptionsJson", "sellerSnapshotJson", "sentAt", "shippingDate", "showArticleNumber", "showDeliveryAddress", "showDescription", "showPrices", "showTax", "snapshotAt", "snapshotSource", "sourceId", "sourceType", "status", "updatedAt") SELECT "archivedAt", "buyerSnapshotJson", "createdAt", "customerId", "deliveredAt", "deliveryDate", "footerText", "headerText", "id", "internalNotes", "issueDate", "notes", "number", "orgId", "printOptionsJson", "sellerSnapshotJson", "sentAt", "shippingDate", "showArticleNumber", "showDeliveryAddress", "showDescription", "showPrices", "showTax", "snapshotAt", "snapshotSource", "sourceId", "sourceType", "status", "updatedAt" FROM "DeliveryNote";
DROP TABLE "DeliveryNote";
ALTER TABLE "new_DeliveryNote" RENAME TO "DeliveryNote";
CREATE INDEX "DeliveryNote_orgId_idx" ON "DeliveryNote"("orgId");
CREATE INDEX "DeliveryNote_customerId_idx" ON "DeliveryNote"("customerId");
CREATE INDEX "DeliveryNote_shippingAddressId_idx" ON "DeliveryNote"("shippingAddressId");
CREATE INDEX "DeliveryNote_contactPersonId_idx" ON "DeliveryNote"("contactPersonId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_orgId_idx" ON "CustomFieldDefinition"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_orgId_key_key" ON "CustomFieldDefinition"("orgId", "key");
