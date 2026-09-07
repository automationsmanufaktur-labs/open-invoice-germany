-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'DE',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "taxNumber" TEXT,
    "vatId" TEXT,
    "kuIdNr" TEXT,
    "smallBusiness" BOOLEAN NOT NULL DEFAULT false,
    "defaultTaxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "iban" TEXT,
    "bic" TEXT,
    "bankName" TEXT,
    "logoPath" TEXT,
    "electronicAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
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
    "vatIdValidatedAt" TIMESTAMP(3),
    "leitwegId" TEXT,
    "peppolId" TEXT,
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "netPriceCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL DEFAULT 19,
    "taxCategory" TEXT NOT NULL DEFAULT 'S',
    "differential" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberRange" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "pattern" TEXT NOT NULL DEFAULT '{PREFIX}{YYYY}-{SEQ}',
    "seqPadding" INTEGER NOT NULL DEFAULT 4,
    "year" INTEGER NOT NULL DEFAULT 0,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ANGEBOT',
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "notes" TEXT,
    "netTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "grossTotalCents" INTEGER NOT NULL DEFAULT 0,
    "convertedToInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "unitNetPriceCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'S',
    "discountPermille" INTEGER NOT NULL DEFAULT 0,
    "lineNetCents" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "type" TEXT NOT NULL DEFAULT 'INVOICE',
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "deliveryStart" TIMESTAMP(3),
    "deliveryEnd" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "buyerReference" TEXT,
    "notes" TEXT,
    "paymentTerms" TEXT,
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
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
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
    "lineNetCents" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'TRANSFER',
    "reference" TEXT,
    "isSkonto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dunning" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" TEXT,
    "level" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "baseInterestRatePermille" INTEGER,
    "interestRatePoints" INTEGER,
    "interestAmountCents" INTEGER NOT NULL DEFAULT 0,
    "lateFeeCents" INTEGER NOT NULL DEFAULT 0,
    "flatFee40Cents" INTEGER NOT NULL DEFAULT 0,
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dunning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "interval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "anchorDay" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "autoFinalize" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceLine" (
    "id" TEXT NOT NULL,
    "recurringInvoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "unitNetPriceCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'S',
    "discountPermille" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecurringInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" SERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diffJson" TEXT NOT NULL DEFAULT '{}',
    "prevHash" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_orgId_idx" ON "Customer"("orgId");

-- CreateIndex
CREATE INDEX "Product_orgId_idx" ON "Product"("orgId");

-- CreateIndex
CREATE INDEX "NumberRange_orgId_idx" ON "NumberRange"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberRange_orgId_docType_year_key" ON "NumberRange"("orgId", "docType", "year");

-- CreateIndex
CREATE INDEX "Quote_orgId_idx" ON "Quote"("orgId");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_orgId_idx" ON "Invoice"("orgId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Dunning_invoiceId_idx" ON "Dunning"("invoiceId");

-- CreateIndex
CREATE INDEX "RecurringInvoice_orgId_idx" ON "RecurringInvoice"("orgId");

-- CreateIndex
CREATE INDEX "RecurringInvoice_customerId_idx" ON "RecurringInvoice"("customerId");

-- CreateIndex
CREATE INDEX "RecurringInvoice_status_nextRunDate_idx" ON "RecurringInvoice"("status", "nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringInvoiceLine_recurringInvoiceId_idx" ON "RecurringInvoiceLine"("recurringInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ChangeLog_orgId_idx" ON "ChangeLog"("orgId");

-- CreateIndex
CREATE INDEX "ChangeLog_entity_entityId_idx" ON "ChangeLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeLog_orgId_prevHash_key" ON "ChangeLog"("orgId", "prevHash");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberRange" ADD CONSTRAINT "NumberRange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dunning" ADD CONSTRAINT "Dunning_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceLine" ADD CONSTRAINT "RecurringInvoiceLine_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

