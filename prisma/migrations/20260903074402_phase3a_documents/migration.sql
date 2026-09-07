/*
  Warnings:

  - A unique constraint covering the columns `[orgId,docType,position,name]` on the table `TextTemplate` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "DeliveryNoteLine" ADD COLUMN "sourceLineId" TEXT;
ALTER TABLE "DeliveryNoteLine" ADD COLUMN "taxRate" INTEGER;
ALTER TABLE "DeliveryNoteLine" ADD COLUMN "unitNetPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "footerText" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "headerText" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "notes" TEXT,
    "internalNotes" TEXT,
    "headerText" TEXT,
    "footerText" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
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
    CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DeliveryNote" ("buyerSnapshotJson", "createdAt", "customerId", "deliveryDate", "id", "internalNotes", "issueDate", "notes", "number", "orgId", "sellerSnapshotJson", "shippingDate", "showPrices", "showTax", "snapshotAt", "snapshotSource", "status", "updatedAt") SELECT "buyerSnapshotJson", "createdAt", "customerId", "deliveryDate", "id", "internalNotes", "issueDate", "notes", "number", "orgId", "sellerSnapshotJson", "shippingDate", "showPrices", "showTax", "snapshotAt", "snapshotSource", "status", "updatedAt" FROM "DeliveryNote";
DROP TABLE "DeliveryNote";
ALTER TABLE "new_DeliveryNote" RENAME TO "DeliveryNote";
CREATE INDEX "DeliveryNote_orgId_idx" ON "DeliveryNote"("orgId");
CREATE INDEX "DeliveryNote_customerId_idx" ON "DeliveryNote"("customerId");
CREATE TABLE "new_Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ANGEBOT',
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "taxScheme" TEXT NOT NULL DEFAULT 'REGULAR',
    "subject" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "headerText" TEXT,
    "footerText" TEXT,
    "deliveryTerms" TEXT,
    "paymentTerms" TEXT,
    "customerReference" TEXT,
    "contactPersonId" TEXT,
    "billingAddressId" TEXT,
    "sellerSnapshotJson" TEXT,
    "buyerSnapshotJson" TEXT,
    "snapshotSource" TEXT,
    "snapshotAt" DATETIME,
    "netTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "grossTotalCents" INTEGER NOT NULL DEFAULT 0,
    "convertedToInvoiceId" TEXT,
    "sentAt" DATETIME,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "ContactPerson" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Quote_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Quote" ("buyerSnapshotJson", "convertedToInvoiceId", "createdAt", "currency", "customerId", "grossTotalCents", "id", "internalNotes", "issueDate", "kind", "netTotalCents", "notes", "number", "orgId", "sellerSnapshotJson", "snapshotAt", "snapshotSource", "status", "taxScheme", "taxTotalCents", "updatedAt", "validUntil") SELECT "buyerSnapshotJson", "convertedToInvoiceId", "createdAt", "currency", "customerId", "grossTotalCents", "id", "internalNotes", "issueDate", "kind", "netTotalCents", "notes", "number", "orgId", "sellerSnapshotJson", "snapshotAt", "snapshotSource", "status", "taxScheme", "taxTotalCents", "updatedAt", "validUntil" FROM "Quote";
DROP TABLE "Quote";
ALTER TABLE "new_Quote" RENAME TO "Quote";
CREATE INDEX "Quote_orgId_idx" ON "Quote"("orgId");
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");
CREATE INDEX "Quote_contactPersonId_idx" ON "Quote"("contactPersonId");
CREATE INDEX "Quote_billingAddressId_idx" ON "Quote"("billingAddressId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TextTemplate_orgId_docType_position_name_key" ON "TextTemplate"("orgId", "docType", "position", "name");

-- Backfill: status CONVERTED wird durch getrennte convertedToInvoiceId-Verknuepfung
-- ersetzt; bestehende Datensaetze erhalten den Status ACCEPTED (Betreiberentscheidung).
UPDATE "Quote" SET "status" = 'ACCEPTED' WHERE "status" = 'CONVERTED';

-- Backfill (Fix-Runde 2, G4): der Wert "DECLINED" stammte aus einer frueheren
-- Schemakommentar-/Statusbenennung, die auf REJECTED umbenannt wurde. Diese Migration
-- ist bislang nicht ausgeliefert (Produktivinstanz noch nicht auf diesem Stand) --
-- idempotent, betrifft nur eventuell vorhandene Datensaetze mit dem alten Wert.
UPDATE "Quote" SET "status" = 'REJECTED' WHERE "status" = 'DECLINED';
