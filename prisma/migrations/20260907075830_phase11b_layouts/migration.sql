-- Phase 11b — PDF-Layouts: Organisationsstandard, Typ-Map, Fusszeilenmodus; Inhaber fuer die Fusszeile.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "ownerName" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BrandingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "layoutId" TEXT NOT NULL DEFAULT 'standard',
    "layoutByTypeJson" TEXT,
    "footerMode" TEXT NOT NULL DEFAULT 'AUTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandingSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BrandingSettings" ("backgroundPath", "createdAt", "fontSizePt", "footerCenter", "footerLeft", "footerRight", "id", "logoPath", "logoWidthMm", "marginBottomMm", "marginLeftMm", "marginRightMm", "marginTopMm", "orgId", "primaryColor", "senderLine", "showBackground", "updatedAt") SELECT "backgroundPath", "createdAt", "fontSizePt", "footerCenter", "footerLeft", "footerRight", "id", "logoPath", "logoWidthMm", "marginBottomMm", "marginLeftMm", "marginRightMm", "marginTopMm", "orgId", "primaryColor", "senderLine", "showBackground", "updatedAt" FROM "BrandingSettings";
DROP TABLE "BrandingSettings";
ALTER TABLE "new_BrandingSettings" RENAME TO "BrandingSettings";
CREATE UNIQUE INDEX "BrandingSettings_orgId_key" ON "BrandingSettings"("orgId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
