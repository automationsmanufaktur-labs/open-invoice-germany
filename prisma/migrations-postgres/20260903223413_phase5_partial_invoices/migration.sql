-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "partialPermille" INTEGER,
ADD COLUMN     "payableCents" INTEGER,
ADD COLUMN     "prepaidCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- CreateTable
CREATE TABLE "FinalInvoiceDeduction" (
    "id" TEXT NOT NULL,
    "finalInvoiceId" TEXT NOT NULL,
    "downpaymentInvoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "netCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "taxCategory" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalInvoiceDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinalInvoiceDeduction_finalInvoiceId_idx" ON "FinalInvoiceDeduction"("finalInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalInvoiceDeduction_finalInvoiceId_downpaymentInvoiceId_t_key" ON "FinalInvoiceDeduction"("finalInvoiceId", "downpaymentInvoiceId", "taxRate", "taxCategory");

-- AddForeignKey
ALTER TABLE "FinalInvoiceDeduction" ADD CONSTRAINT "FinalInvoiceDeduction_finalInvoiceId_fkey" FOREIGN KEY ("finalInvoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalInvoiceDeduction" ADD CONSTRAINT "FinalInvoiceDeduction_downpaymentInvoiceId_fkey" FOREIGN KEY ("downpaymentInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
