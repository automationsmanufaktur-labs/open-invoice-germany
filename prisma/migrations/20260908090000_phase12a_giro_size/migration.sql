-- Phase 12a — GiroCode-Groesse als Druckoption (bisher fest 30 mm im Renderer).
-- AlterTable
ALTER TABLE "PrintSettings" ADD COLUMN "giroSizeMm" INTEGER NOT NULL DEFAULT 22;
