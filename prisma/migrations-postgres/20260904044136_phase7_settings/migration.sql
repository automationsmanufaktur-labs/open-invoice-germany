-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "customerNumber" TEXT;

-- AlterTable
ALTER TABLE "DeliveryNote" ADD COLUMN     "printOptionsJson" TEXT,
ADD COLUMN     "showDeliveryAddress" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "DocumentSettings" ADD COLUMN     "autoDeliveryDate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoFinalizeOnSend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "defaultPaymentMethodId" TEXT,
ADD COLUMN     "dnShowArticleNumber" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dnShowDeliveryAddress" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dnShowPrices" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eInvoiceDefault" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoiceDueDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "offerLastDocument" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "recurringAutoFinalizeDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringAutoSendDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringInsertPeriodText" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "refreshIssueDateOnFinalize" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shareLinkDefaultOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showPaymentTermsText" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "printOptionsJson" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "printOptionsJson" TEXT;

-- AlterTable
ALTER TABLE "RecurringInvoice" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BrandingSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "logoPath" TEXT,
    "logoWidthMm" INTEGER NOT NULL DEFAULT 40,
    "primaryColor" TEXT NOT NULL DEFAULT '#111111',
    "senderLine" TEXT,
    "footerLeft" TEXT,
    "footerCenter" TEXT,
    "footerRight" TEXT,
    "marginTopMm" INTEGER NOT NULL DEFAULT 20,
    "marginRightMm" INTEGER NOT NULL DEFAULT 18,
    "marginBottomMm" INTEGER NOT NULL DEFAULT 20,
    "marginLeftMm" INTEGER NOT NULL DEFAULT 18,
    "fontSizePt" INTEGER NOT NULL DEFAULT 10,
    "backgroundPath" TEXT,
    "showBackground" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "showFooter" BOOLEAN NOT NULL DEFAULT true,
    "showPageNumbers" BOOLEAN NOT NULL DEFAULT true,
    "foldMarks" BOOLEAN NOT NULL DEFAULT false,
    "punchMarks" BOOLEAN NOT NULL DEFAULT false,
    "showArticleNumber" BOOLEAN NOT NULL DEFAULT true,
    "showDescription" BOOLEAN NOT NULL DEFAULT true,
    "showTaxRatePerLine" BOOLEAN NOT NULL DEFAULT true,
    "showLineTotals" BOOLEAN NOT NULL DEFAULT true,
    "showSenderLine" BOOLEAN NOT NULL DEFAULT true,
    "showGiroCode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandingSettings_orgId_key" ON "BrandingSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintSettings_orgId_key" ON "PrintSettings"("orgId");

-- CreateIndex
CREATE INDEX "Customer_orgId_customerNumber_idx" ON "Customer"("orgId", "customerNumber");

-- AddForeignKey
ALTER TABLE "BrandingSettings" ADD CONSTRAINT "BrandingSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintSettings" ADD CONSTRAINT "PrintSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

