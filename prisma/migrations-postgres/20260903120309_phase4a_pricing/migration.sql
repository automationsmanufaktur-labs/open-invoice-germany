-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "documentChargeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "documentChargePermille" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "documentChargeReason" TEXT,
ADD COLUMN     "documentDiscountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "documentDiscountPermille" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethodId" TEXT,
ADD COLUMN     "paymentMethodSnapshotJson" TEXT,
ADD COLUMN     "skonto1Days" INTEGER,
ADD COLUMN     "skonto1Permille" INTEGER,
ADD COLUMN     "skonto2Days" INTEGER,
ADD COLUMN     "skonto2Permille" INTEGER;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "skontoForPaymentId" TEXT;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "bankBic" TEXT,
ADD COLUMN     "bankIban" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "documentChargeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "documentChargePermille" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "documentChargeReason" TEXT,
ADD COLUMN     "documentDiscountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "documentDiscountPermille" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Invoice_paymentMethodId_idx" ON "Invoice"("paymentMethodId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (Postgres): Systemzahlungsmethode SKONTO je Organisation nachziehen
-- (Muster Phase-1-Backfill, src/domain/masterdata/defaults.ts SYSTEM_PAYMENT_METHODS).
INSERT INTO "PaymentMethod" ("id","orgId","code","name","untdidCode","isSystem","isActive","sortOrder","createdAt","updatedAt")
SELECT 'pm_' || o."id" || '_SKONTO', o."id", 'SKONTO', 'Skonto', 'ZZZ', true, true, 9, NOW(), NOW()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" p WHERE p."orgId" = o."id" AND p."code" = 'SKONTO');
