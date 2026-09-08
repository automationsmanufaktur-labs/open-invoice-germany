-- Phase 12c — White-Label: eigener Produktname, Kurzname, Favicon, Sidebar-Logo.
-- Additiv, alle vier NULL-bar; NULL = heutiges Verhalten, keine Datenmigration noetig.
-- AlterTable
ALTER TABLE "BrandingSettings" ADD COLUMN "appName" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN "appShortName" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN "faviconPath" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN "appLogoPath" TEXT;
