-- Phase 11b — PDF-Layouts: Organisationsstandard, Typ-Map, Fusszeilenmodus; Inhaber fuer die Fusszeile.
-- AlterTable
ALTER TABLE "BrandingSettings" ADD COLUMN "layoutId" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "BrandingSettings" ADD COLUMN "layoutByTypeJson" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN "footerMode" TEXT NOT NULL DEFAULT 'AUTO';
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "ownerName" TEXT;
