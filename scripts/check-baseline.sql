-- Bricht ab, wenn Anwendungstabellen existieren, aber keine Migrationshistorie.
-- Das ist genau der Zustand einer per "prisma db push" erzeugten Bestandsdatenbank.
--
-- Der Marker ist bewusst ein eigener Text: "prisma migrate deploy" erkennt laut
-- Prisma-Doku keinen Drift und wuerde die Baseline blind anwenden, sodass ein
-- PostgreSQL-Fehler entstuende statt eines stabilen Prisma-Fehlercodes.
-- Eigenes SQL bleibt ueber Versionswechsel hinweg verlaesslich.
DO $$
BEGIN
  IF to_regclass('public."Organization"') IS NOT NULL
     AND to_regclass('public."_prisma_migrations"') IS NULL
  THEN
    RAISE EXCEPTION 'OIG_BASELINE_REQUIRED';
  END IF;
END
$$;
