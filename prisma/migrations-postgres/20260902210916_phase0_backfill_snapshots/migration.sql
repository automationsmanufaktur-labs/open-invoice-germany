-- Phase 0: Bestandsbelege einfrieren. Snapshot aus dem HEUTIGEN Stamm, Herkunft MIGRATION
-- (Betreiberentscheidung). Nur Belege ohne Snapshot; Entwuerfe bleiben live.
-- Diese Datei wird vom Integrationstest wortgleich ausgefuehrt — Schluesselnamen muessen
-- exakt sellerSnapshotSchema/buyerSnapshotSchema (src/schemas/index.ts) entsprechen.
UPDATE "Invoice" SET
  "sellerSnapshotJson" = (SELECT json_build_object(
      'legalName', o."legalName", 'addressLine1', o."addressLine1", 'addressLine2', o."addressLine2",
      'postalCode', o."postalCode", 'city', o."city", 'country', o."country", 'vatId', o."vatId",
      'taxNumber', o."taxNumber", 'email', o."email", 'phone', o."phone",
      'electronicAddress', o."electronicAddress", 'iban', o."iban", 'bic', o."bic", 'bankName', o."bankName")::text
    FROM "Organization" o WHERE o."id" = "Invoice"."orgId"),
  "buyerSnapshotJson" = (SELECT json_build_object(
      'name', c."name", 'contactName', c."contactName", 'addressLine1', c."addressLine1",
      'addressLine2', c."addressLine2", 'postalCode', c."postalCode", 'city', c."city",
      'countryCode', c."countryCode", 'vatId', c."vatId", 'email', c."email", 'leitwegId', c."leitwegId")::text
    FROM "Customer" c WHERE c."id" = "Invoice"."customerId"),
  "snapshotSource" = 'MIGRATION',
  "snapshotAt" = NOW()
WHERE "status" <> 'DRAFT' AND "snapshotSource" IS NULL;

UPDATE "Quote" SET
  "sellerSnapshotJson" = (SELECT json_build_object(
      'legalName', o."legalName", 'addressLine1', o."addressLine1", 'addressLine2', o."addressLine2",
      'postalCode', o."postalCode", 'city', o."city", 'country', o."country", 'vatId', o."vatId",
      'taxNumber', o."taxNumber", 'email', o."email", 'phone', o."phone",
      'electronicAddress', o."electronicAddress", 'iban', o."iban", 'bic', o."bic", 'bankName', o."bankName")::text
    FROM "Organization" o WHERE o."id" = "Quote"."orgId"),
  "buyerSnapshotJson" = (SELECT json_build_object(
      'name', c."name", 'contactName', c."contactName", 'addressLine1', c."addressLine1",
      'addressLine2', c."addressLine2", 'postalCode', c."postalCode", 'city', c."city",
      'countryCode', c."countryCode", 'vatId', c."vatId", 'email', c."email", 'leitwegId', c."leitwegId")::text
    FROM "Customer" c WHERE c."id" = "Quote"."customerId"),
  "snapshotSource" = 'MIGRATION',
  "snapshotAt" = NOW()
WHERE "number" IS NOT NULL AND "snapshotSource" IS NULL;
