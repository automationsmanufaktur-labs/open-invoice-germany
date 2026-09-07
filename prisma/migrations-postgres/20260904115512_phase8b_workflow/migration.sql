-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "RecurringInvoice" ADD COLUMN     "emailTemplateId" TEXT,
ADD COLUMN     "maxRuns" INTEGER,
ADD COLUMN     "showPeriodText" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "RecurringInvoice_emailTemplateId_idx" ON "RecurringInvoice"("emailTemplateId");

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
