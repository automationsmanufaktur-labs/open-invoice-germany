-- Phase 12c — org-eigene Steuersaetze. Bestandszeilen bekommen per Default die bisher
-- fest verdrahtete Liste [19,7,0]; kein Beleg wird angefasst.
-- AlterTable
ALTER TABLE "DocumentSettings" ADD COLUMN "taxRatesJson" TEXT NOT NULL DEFAULT '[19,7,0]';
