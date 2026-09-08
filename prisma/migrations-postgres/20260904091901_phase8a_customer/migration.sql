-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "customFieldsJson" TEXT,
ADD COLUMN     "defaultCurrency" TEXT,
ADD COLUMN     "defaultDiscountPermille" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryTermsText" TEXT,
ADD COLUMN     "eInvoicePreferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invoiceCc" TEXT,
ADD COLUMN     "invoiceEmail" TEXT,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'de',
ADD COLUMN     "orderReference" TEXT,
ADD COLUMN     "paymentTermsText" TEXT,
ADD COLUMN     "quoteEmail" TEXT;

-- AlterTable
ALTER TABLE "DeliveryNote" ADD COLUMN     "contactPersonId" TEXT,
ADD COLUMN     "contactSnapshotJson" TEXT,
ADD COLUMN     "shippingAddressId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "contactSnapshotJson" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "contactSnapshotJson" TEXT;

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "optionsJson" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_orgId_idx" ON "CustomFieldDefinition"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_orgId_key_key" ON "CustomFieldDefinition"("orgId", "key");

-- CreateIndex
CREATE INDEX "DeliveryNote_shippingAddressId_idx" ON "DeliveryNote"("shippingAddressId");

-- CreateIndex
CREATE INDEX "DeliveryNote_contactPersonId_idx" ON "DeliveryNote"("contactPersonId");

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
