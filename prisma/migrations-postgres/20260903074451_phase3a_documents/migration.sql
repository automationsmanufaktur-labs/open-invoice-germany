/*
  Warnings:

  - A unique constraint covering the columns `[orgId,docType,position,name]` on the table `TextTemplate` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "DeliveryNote" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "headerText" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "showArticleNumber" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showDescription" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "DeliveryNoteLine" ADD COLUMN     "sourceLineId" TEXT,
ADD COLUMN     "taxRate" INTEGER,
ADD COLUMN     "unitNetPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "headerText" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "billingAddressId" TEXT,
ADD COLUMN     "contactPersonId" TEXT,
ADD COLUMN     "customerReference" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "deliveryTerms" TEXT,
ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "headerText" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "subject" TEXT;

-- CreateIndex
CREATE INDEX "Quote_contactPersonId_idx" ON "Quote"("contactPersonId");

-- CreateIndex
CREATE INDEX "Quote_billingAddressId_idx" ON "Quote"("billingAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "TextTemplate_orgId_docType_position_name_key" ON "TextTemplate"("orgId", "docType", "position", "name");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: status CONVERTED wird durch getrennte convertedToInvoiceId-Verknuepfung
-- ersetzt; bestehende Datensaetze erhalten den Status ACCEPTED (Betreiberentscheidung).
UPDATE "Quote" SET "status" = 'ACCEPTED' WHERE "status" = 'CONVERTED';

-- Backfill (Fix-Runde 2, G4): der Wert "DECLINED" stammte aus einer frueheren
-- Schemakommentar-/Statusbenennung, die auf REJECTED umbenannt wurde. Diese Migration
-- ist bislang nicht ausgeliefert (Produktivinstanz noch nicht auf diesem Stand) --
-- idempotent, betrifft nur eventuell vorhandene Datensaetze mit dem alten Wert.
UPDATE "Quote" SET "status" = 'REJECTED' WHERE "status" = 'DECLINED';
