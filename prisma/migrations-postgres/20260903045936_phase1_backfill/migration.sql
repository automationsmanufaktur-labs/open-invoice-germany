-- Phase 1 Backfill (PostgreSQL). Idempotent: jede Anweisung prueft Existenz.
-- 1) Vorhandene Verknuepfungen in DocumentRelation spiegeln (Altfelder bleiben).
INSERT INTO "DocumentRelation" ("id","orgId","fromType","fromId","toType","toId","relationType","createdAt")
SELECT 'rel_conv_' || q."id", q."orgId", 'QUOTE', q."id", 'INVOICE', q."convertedToInvoiceId", 'CONVERTED_TO', NOW()
FROM "Quote" q WHERE q."convertedToInvoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "DocumentRelation" r WHERE r."fromType"='QUOTE' AND r."fromId"=q."id" AND r."relationType"='CONVERTED_TO');
INSERT INTO "DocumentRelation" ("id","orgId","fromType","fromId","toType","toId","relationType","createdAt")
SELECT 'rel_corr_' || i."id", i."orgId", 'INVOICE', i."id", 'INVOICE', i."correctsInvoiceId", 'CORRECTS', NOW()
FROM "Invoice" i WHERE i."correctsInvoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "DocumentRelation" r WHERE r."fromType"='INVOICE' AND r."fromId"=i."id" AND r."relationType"='CORRECTS');
INSERT INTO "DocumentRelation" ("id","orgId","fromType","fromId","toType","toId","relationType","createdAt")
SELECT 'rel_rev_' || i."id", i."orgId", 'INVOICE', i."reversedByInvoiceId", 'INVOICE', i."id", 'REVERSES', NOW()
FROM "Invoice" i WHERE i."reversedByInvoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "DocumentRelation" r WHERE r."fromType"='INVOICE' AND r."fromId"=i."reversedByInvoiceId" AND r."toId"=i."id" AND r."relationType"='REVERSES');
INSERT INTO "DocumentRelation" ("id","orgId","fromType","fromId","toType","toId","relationType","createdAt")
SELECT 'rel_gen_' || i."id", i."orgId", 'INVOICE', i."id", 'RECURRING', i."recurringInvoiceId", 'GENERATED_BY', NOW()
FROM "Invoice" i WHERE i."recurringInvoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "DocumentRelation" r WHERE r."fromType"='INVOICE' AND r."fromId"=i."id" AND r."relationType"='GENERATED_BY');

-- 2) Systemzahlungsmethoden je Organisation (Codes/Namen = src/domain/masterdata/defaults.ts).
INSERT INTO "PaymentMethod" ("id","orgId","code","name","untdidCode","isSystem","isActive","sortOrder","createdAt","updatedAt")
SELECT 'pm_' || o."id" || '_' || m.code, o."id", m.code, m.name, m.untdid, TRUE, TRUE, m.sort,
       NOW(), NOW()
FROM "Organization" o,
  (SELECT 'TRANSFER'::text AS code, 'Ueberweisung' AS name, '58' AS untdid, 1::int AS sort
   UNION ALL SELECT 'CASH','Barzahlung','10',2
   UNION ALL SELECT 'CARD','EC-/Debitkarte','48',3
   UNION ALL SELECT 'CREDIT_CARD','Kreditkarte','54',4
   UNION ALL SELECT 'PAYPAL','PayPal','68',5
   UNION ALL SELECT 'SEPA','SEPA-Lastschrift','59',6
   UNION ALL SELECT 'PREPAID','Bereits bezahlt','ZZZ',7
   UNION ALL SELECT 'OTHER','Sonstige','ZZZ',8) m
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" p WHERE p."orgId"=o."id" AND p."code"=m.code);

-- 3) Standard-Mahnstufen je Organisation (Werte = DEFAULT_DUNNING_STAGES).
INSERT INTO "DunningStage" ("id","orgId","order","name","daysAfterDue","newDueDays","feeCents","calculateInterest","includeB2BFlatFee","enabled","createdAt","updatedAt")
SELECT 'ds_' || o."id" || '_' || s.ord, o."id", s.ord, s.name, s.days, 14, 0, s.interest, s.flat, TRUE,
       NOW(), NOW()
FROM "Organization" o,
  (SELECT 0::int AS ord, 'Zahlungserinnerung' AS name, 3 AS days, FALSE::boolean AS interest, FALSE::boolean AS flat
   UNION ALL SELECT 1,'1. Mahnung',10,TRUE,TRUE
   UNION ALL SELECT 2,'2. Mahnung',10,TRUE,TRUE
   UNION ALL SELECT 3,'3. Mahnung',7,TRUE,TRUE) s
WHERE NOT EXISTS (SELECT 1 FROM "DunningStage" d WHERE d."orgId"=o."id" AND d."order"=s.ord);

-- 4) Bestandsmahnungen der passenden Stufe zuordnen: Zuordnung per (orgId, order),
-- unabhaengig vom ID-Format der DunningStage-Zeile (Migration oder App-Code).
UPDATE "Dunning" SET "stageId" = (
  SELECT d."id" FROM "DunningStage" d
  WHERE d."orgId" = (SELECT i."orgId" FROM "Invoice" i WHERE i."id" = "Dunning"."invoiceId")
    AND d."order" = "Dunning"."level"
)
WHERE "stageId" IS NULL AND "level" BETWEEN 0 AND 3;
