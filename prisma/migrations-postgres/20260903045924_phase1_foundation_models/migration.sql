-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "defaultPaymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "Dunning" ADD COLUMN     "stageId" TEXT;

-- CreateTable
CREATE TABLE "DocumentRelation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryNote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "shippingDate" TIMESTAMP(3),
    "showPrices" BOOLEAN NOT NULL DEFAULT false,
    "showTax" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "internalNotes" TEXT,
    "sellerSnapshotJson" TEXT,
    "buyerSnapshotJson" TEXT,
    "snapshotSource" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryNoteLine" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "description" TEXT NOT NULL,
    "articleNumber" TEXT,
    "quantityMilli" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'C62',

    CONSTRAINT "DeliveryNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signature" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "templateId" TEXT,
    "toJson" TEXT NOT NULL DEFAULT '[]',
    "ccJson" TEXT NOT NULL DEFAULT '[]',
    "bccJson" TEXT NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "bodySnapshot" TEXT NOT NULL,
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'DE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPerson" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "paymentTermsDays" INTEGER,
    "invoiceText" TEXT,
    "bankAccountRef" TEXT,
    "untdidCode" TEXT NOT NULL DEFAULT 'ZZZ',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningStage" (
    "id" TEXT NOT NULL,
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
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRelation_orgId_idx" ON "DocumentRelation"("orgId");

-- CreateIndex
CREATE INDEX "DocumentRelation_fromType_fromId_idx" ON "DocumentRelation"("fromType", "fromId");

-- CreateIndex
CREATE INDEX "DocumentRelation_toType_toId_idx" ON "DocumentRelation"("toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRelation_fromType_fromId_toType_toId_relationType_key" ON "DocumentRelation"("fromType", "fromId", "toType", "toId", "relationType");

-- CreateIndex
CREATE INDEX "DeliveryNote_orgId_idx" ON "DeliveryNote"("orgId");

-- CreateIndex
CREATE INDEX "DeliveryNote_customerId_idx" ON "DeliveryNote"("customerId");

-- CreateIndex
CREATE INDEX "DeliveryNoteLine_deliveryNoteId_idx" ON "DeliveryNoteLine"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "TextTemplate_orgId_docType_idx" ON "TextTemplate"("orgId", "docType");

-- CreateIndex
CREATE INDEX "EmailTemplate_orgId_docType_idx" ON "EmailTemplate"("orgId", "docType");

-- CreateIndex
CREATE INDEX "EmailLog_orgId_idx" ON "EmailLog"("orgId");

-- CreateIndex
CREATE INDEX "EmailLog_docType_docId_idx" ON "EmailLog"("docType", "docId");

-- CreateIndex
CREATE INDEX "CustomerAddress_orgId_idx" ON "CustomerAddress"("orgId");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "ContactPerson_orgId_idx" ON "ContactPerson"("orgId");

-- CreateIndex
CREATE INDEX "ContactPerson_customerId_idx" ON "ContactPerson"("customerId");

-- CreateIndex
CREATE INDEX "PaymentMethod_orgId_idx" ON "PaymentMethod"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_orgId_code_key" ON "PaymentMethod"("orgId", "code");

-- CreateIndex
CREATE INDEX "DunningStage_orgId_idx" ON "DunningStage"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DunningStage_orgId_order_key" ON "DunningStage"("orgId", "order");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_defaultPaymentMethodId_fkey" FOREIGN KEY ("defaultPaymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dunning" ADD CONSTRAINT "Dunning_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "DunningStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNoteLine" ADD CONSTRAINT "DeliveryNoteLine_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "DeliveryNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextTemplate" ADD CONSTRAINT "TextTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPerson" ADD CONSTRAINT "ContactPerson_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPerson" ADD CONSTRAINT "ContactPerson_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningStage" ADD CONSTRAINT "DunningStage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningStage" ADD CONSTRAINT "DunningStage_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
