-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "vatIdValidatedAt" DATETIME,
    "leitwegId" TEXT,
    "peppolId" TEXT,
    "defaultPaymentTermsDays" INTEGER,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "customerNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "defaultPaymentMethodId" TEXT,
    CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_defaultPaymentMethodId_fkey" FOREIGN KEY ("defaultPaymentMethodId") REFERENCES "PaymentMethod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("addressLine1", "addressLine2", "city", "contactName", "countryCode", "createdAt", "customerNumber", "defaultPaymentMethodId", "defaultPaymentTermsDays", "email", "id", "isArchived", "leitwegId", "name", "notes", "orgId", "peppolId", "phone", "postalCode", "type", "updatedAt", "vatId", "vatIdValidatedAt") SELECT "addressLine1", "addressLine2", "city", "contactName", "countryCode", "createdAt", "customerNumber", "defaultPaymentMethodId", "defaultPaymentTermsDays", "email", "id", "isArchived", "leitwegId", "name", "notes", "orgId", "peppolId", "phone", "postalCode", "type", "updatedAt", "vatId", "vatIdValidatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_orgId_idx" ON "Customer"("orgId");
CREATE INDEX "Customer_orgId_customerNumber_idx" ON "Customer"("orgId", "customerNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill (S1, Betreiberentscheidung analog Alt-Belege-Snapshots): bisher war die Spalte
-- `NOT NULL DEFAULT 14` — JEDE Zeile hatte also entweder den Default 14 (nie bewusst gesetzt)
-- oder einen frueher explizit gesetzten Wert, ohne dass beides unterscheidbar war. Ab jetzt
-- bedeutet NULL "kein Kunden-Override" (kaskadiert auf Zahlungsmethode/invoiceDueDays/14).
-- Da 14 der einzig moegliche unbewusste Wert war, werden nur Zeilen mit GENAU 14 auf NULL
-- zurueckgesetzt — ein Kunde, dessen Zahlungsziel jemals bewusst auf einen ANDEREN Wert
-- geaendert wurde, behaelt diesen expliziten Override unveraendert.
UPDATE "Customer" SET "defaultPaymentTermsDays" = NULL WHERE "defaultPaymentTermsDays" = 14;
