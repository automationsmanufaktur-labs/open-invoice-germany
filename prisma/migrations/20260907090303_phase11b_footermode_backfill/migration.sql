-- Phase 11b Fix 1 — footerMode-Backfill: Organisationen, die bereits Freitext in
-- footerLeft/-Center/-Right gepflegt haben (Phase 7), aber footerMode nie explizit
-- gesetzt haben (Default seit Task 1 = 'AUTO'), sollen ihre Freitext-Fusszeile nicht
-- verlieren, sobald footer.ts strikt auf footerMode = 'CUSTOM' prueft (siehe Fix-Runde 1).
UPDATE "BrandingSettings" SET "footerMode" = 'CUSTOM' WHERE COALESCE("footerLeft", '') <> '' OR COALESCE("footerCenter", '') <> '' OR COALESCE("footerRight", '') <> '';
