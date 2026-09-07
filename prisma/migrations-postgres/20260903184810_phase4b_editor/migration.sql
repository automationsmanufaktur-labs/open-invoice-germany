-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billingAddressId" TEXT,
ADD COLUMN     "contactPersonId" TEXT,
ADD COLUMN     "internalReference" TEXT,
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "shippingAddressId" TEXT,
ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "articleNumber" TEXT,
ADD COLUMN     "descriptionLong" TEXT,
ADD COLUMN     "lineType" TEXT NOT NULL DEFAULT 'ITEM';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "articleNumber" TEXT;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "articleNumber" TEXT,
ADD COLUMN     "descriptionLong" TEXT,
ADD COLUMN     "lineType" TEXT NOT NULL DEFAULT 'ITEM';

-- CreateTable
CREATE TABLE "DocumentAttachment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentAttachment_orgId_docType_docId_idx" ON "DocumentAttachment"("orgId", "docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAttachment_orgId_sha256_docType_docId_key" ON "DocumentAttachment"("orgId", "sha256", "docType", "docId");

-- CreateIndex
CREATE INDEX "Invoice_contactPersonId_idx" ON "Invoice"("contactPersonId");

-- CreateIndex
CREATE INDEX "Invoice_billingAddressId_idx" ON "Invoice"("billingAddressId");

-- CreateIndex
CREATE INDEX "Invoice_shippingAddressId_idx" ON "Invoice"("shippingAddressId");

-- CreateIndex
CREATE INDEX "Product_orgId_articleNumber_idx" ON "Product"("orgId", "articleNumber");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
