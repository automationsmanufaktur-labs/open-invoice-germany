#!/usr/bin/env bash
# Testet den Postgres-Migrationspfad gegen einen Wegwerf-Container.
# Voraussetzung: laufender Docker-Daemon. Aufruf: ./scripts/test-postgres-migrations.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=oig-migtest
PORT=55433
export DATABASE_URL="postgresql://oig:test@localhost:${PORT}/openinvoice?schema=public"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

fail() { echo "FEHLGESCHLAGEN: $1" >&2; exit 1; }

# Portabel: macOS hat kein timeout(1). Beendet den Befehl nach N Sekunden.
run_with_timeout() {
  local secs=$1; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) & local killer=$!
  wait "$pid"; local rc=$?
  kill "$killer" 2>/dev/null; wait "$killer" 2>/dev/null || true
  return $rc
}

echo "==> Wegwerf-PostgreSQL starten"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=oig -e POSTGRES_PASSWORD=test -e POSTGRES_DB=openinvoice \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U oig -d openinvoice >/dev/null 2>&1 && { ready=1; break; }
  sleep 1
done
[ "$ready" = "1" ] || fail "PostgreSQL wurde nicht bereit"

echo "==> Fall 1: frische Datenbank"
run_with_timeout 120 ./scripts/db-prepare.sh >/dev/null
COUNT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
[ "$COUNT" = "35" ] || fail "erwartet 35 Tabellen, gefunden $COUNT"
echo "    ok — 35 Tabellen angelegt (inkl. _prisma_migrations; Phase 7: BrandingSettings, PrintSettings)"

echo "==> Datenbank leeren und Bestandslage herstellen"
docker exec "$CONTAINER" psql -U oig -d openinvoice \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
# Bestands-DB = exakt der Baseline-Stand, ohne Migrationshistorie und ohne spaetere Spalten.
npx prisma db execute --url "$DATABASE_URL" \
  --file prisma/migrations-postgres/0_init/migration.sql >/dev/null
# Legacy-Belege fuer den Backfill-Test (Fall 5): Organisation, Kunde, festgeschriebene Rechnung.
docker exec -i "$CONTAINER" psql -U oig -d openinvoice -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO "Organization" ("id","legalName","addressLine1","postalCode","city","updatedAt")
  VALUES ('org1','Müller & Söhne GmbH','Weg 1','12345','Lüneburg',NOW());
INSERT INTO "Customer" ("id","orgId","name","addressLine1","postalCode","city","updatedAt")
  VALUES ('cust1','org1','O''Brien AG','Str. 2','54321','Altdorf',NOW());
INSERT INTO "Invoice" ("id","orgId","customerId","number","status","updatedAt")
  VALUES ('inv1','org1','cust1','RE-2026-00001','FINALIZED',NOW());
INSERT INTO "Quote" ("id","orgId","customerId","kind","number","status","convertedToInvoiceId","updatedAt")
  VALUES ('q1','org1','cust1','ANGEBOT','AN-2026-0001','CONVERTED','inv1',NOW());
INSERT INTO "Quote" ("id","orgId","customerId","kind","number","status","convertedToInvoiceId","updatedAt")
  VALUES ('q2','org1','cust1','ANGEBOT','AN-2026-0002','CONVERTED','inv1',NOW());
-- q3: Legacy-Angebot mit einem Status, der von der Phase-3a-Backfill-Zeile (CONVERTED->
-- ACCEPTED) NICHT betroffen ist -- muss unveraendert 'SENT' bleiben (Task-6-Ergaenzung).
INSERT INTO "Quote" ("id","orgId","customerId","kind","number","status","convertedToInvoiceId","updatedAt")
  VALUES ('q3','org1','cust1','ANGEBOT','AN-2026-0003','SENT',NULL,NOW());
INSERT INTO "Payment" ("id","invoiceId","amountCents","method") VALUES ('pay1','inv1',100,'TRANSFER');
INSERT INTO "Dunning" ("id","invoiceId","level") VALUES ('dun1','inv1',1);
SQL

echo "==> Fall 2: Bestands-DB ohne Historie wird erkannt"
if OUT=$(run_with_timeout 120 ./scripts/db-prepare.sh 2>&1); then
  fail "db-prepare.sh haette abbrechen muessen"
fi
printf '%s' "$OUT" | grep -q "migrate resolve" \
  || fail "Abbruchmeldung nennt den noetigen Befehl nicht"
COUNT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
[ "$COUNT" = "14" ] || fail "db-prepare.sh hat die Daten veraendert ($COUNT Tabellen)"
echo "    ok — abgebrochen, Daten unveraendert"

echo "==> Fall 3: nach Baseline laeuft deploy durch"
npx prisma migrate resolve --config prisma.postgres.config.ts --applied 0_init >/dev/null
npx prisma migrate deploy --config prisma.postgres.config.ts >/dev/null \
  || fail "deploy nach Baseline fehlgeschlagen"
npx prisma migrate deploy --config prisma.postgres.config.ts 2>&1 \
  | grep -q "No pending migrations" || fail "zweiter deploy war nicht wirkungslos"
MAILSETTINGS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select to_regclass('\"MailSettings\"') is not null")
[ "$MAILSETTINGS" = "t" ] || fail "Tabelle MailSettings fehlt nach deploy"
IDX=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from pg_indexes where indexname='EmailTemplate_orgId_docType_name_key'")
[ "$IDX" = "1" ] || fail "Index EmailTemplate_orgId_docType_name_key fehlt nach deploy"
# Phase 5: zwei Migrationen (phase5_partial_invoices + invoice_line_source_line_id) muessen
# beide angewendet sein (FinalInvoiceDeduction-Tabelle + InvoiceLine.sourceLineId-Spalte).
FID=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select to_regclass('\"FinalInvoiceDeduction\"') is not null")
[ "$FID" = "t" ] || fail "Tabelle FinalInvoiceDeduction fehlt nach deploy"
FIDUNIQUE=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from pg_indexes where indexname='FinalInvoiceDeduction_finalInvoiceId_downpaymentInvoiceId_t_key'")
[ "$FIDUNIQUE" = "1" ] || fail "Unique-Index auf FinalInvoiceDeduction fehlt nach deploy"
SRCLINE=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from information_schema.columns where table_name='InvoiceLine' and column_name='sourceLineId'")
[ "$SRCLINE" = "1" ] || fail "InvoiceLine.sourceLineId fehlt nach deploy"
PHASE5MIG=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from _prisma_migrations where migration_name in ('20260903223413_phase5_partial_invoices','20260903225405_invoice_line_source_line_id') and finished_at is not null")
[ "$PHASE5MIG" = "2" ] || fail "erwartet beide Phase-5-Migrationen als angewendet in _prisma_migrations, gefunden $PHASE5MIG"
echo "    ok — Baseline verbucht, Folgemigrationen angewendet (inkl. beider Phase-5-Migrationen), deploy idempotent, MailSettings/EmailTemplate-Index/FinalInvoiceDeduction vorhanden"

echo "==> Fall 4: db-prepare.sh nach Baseline ist wirkungslos"
OUT=$(run_with_timeout 120 ./scripts/db-prepare.sh 2>&1) \
  || fail "db-prepare.sh haette mit Exit 0 durchlaufen sollen"
printf '%s' "$OUT" | grep -q "No pending migrations" \
  || fail "db-prepare.sh hat keine ausstehenden Migrationen gemeldet"
echo "    ok — db-prepare.sh laeuft nach Baseline sauber durch"

echo "==> Fall 5: Backfill friert Legacy-Belege ein"
SRC=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"snapshotSource\" from \"Invoice\" where id='inv1'")
[ "$SRC" = "MIGRATION" ] || fail "snapshotSource ist '$SRC', erwartet MIGRATION"
NAME=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select (\"buyerSnapshotJson\"::jsonb)->>'name' from \"Invoice\" where id='inv1'")
[ "$NAME" = "O'Brien AG" ] || fail "Buyer-Snapshot enthaelt $NAME, erwartet O'Brien AG"
KEYS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from \"Invoice\", jsonb_object_keys(\"sellerSnapshotJson\"::jsonb) where id='inv1'" 2>/dev/null || echo 0)
[ "$KEYS" = "14" ] || fail "Seller-Snapshot hat $KEYS Schluessel, erwartet 14"
BKEYS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from \"Invoice\", jsonb_object_keys(\"buyerSnapshotJson\"::jsonb) where id='inv1'" 2>/dev/null || echo 0)
[ "$BKEYS" = "10" ] || fail "Buyer-Snapshot hat $BKEYS Schluessel, erwartet 10"
echo "    ok — Backfill mit Herkunft MIGRATION, JSON gueltig"

echo "==> Fall 6: Phase-1-Backfill (Relationen, Stammdaten, Mahnstufen, Legacy-Quote-Status)"
REL=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"relationType\" from \"DocumentRelation\" where \"fromId\"='q1'")
[ "$REL" = "CONVERTED_TO" ] || fail "Relation fuer q1 fehlt ('$REL')"
Q1STATUS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select status from \"Quote\" where id='q1'")
[ "$Q1STATUS" = "ACCEPTED" ] || fail "q1 hat Status '$Q1STATUS', erwartet ACCEPTED (Phase-3a-Backfill CONVERTED->ACCEPTED)"
Q2STATUS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select status from \"Quote\" where id='q2'")
[ "$Q2STATUS" = "ACCEPTED" ] || fail "q2 hat Status '$Q2STATUS', erwartet ACCEPTED (Phase-3a-Backfill CONVERTED->ACCEPTED)"
Q3STATUS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select status from \"Quote\" where id='q3'")
[ "$Q3STATUS" = "SENT" ] || fail "q3 hat Status '$Q3STATUS', erwartet unveraendert SENT (Backfill betrifft nur CONVERTED)"
CONVCOUNT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from \"DocumentRelation\" where \"relationType\"='CONVERTED_TO' and \"fromType\"='QUOTE'")
[ "$CONVCOUNT" = "2" ] || fail "erwartet 2 CONVERTED_TO-Relationen (q1, q2), gefunden $CONVCOUNT"
PM=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select count(*) from \"PaymentMethod\" where \"orgId\"='org1'")
[ "$PM" = "9" ] || fail "erwartet 9 Zahlungsmethoden (Phase-4a-Backfill legt SKONTO an), gefunden $PM"
DS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select count(*) from \"DunningStage\" where \"orgId\"='org1'")
[ "$DS" = "4" ] || fail "erwartet 4 Mahnstufen, gefunden $DS"
ST=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select \"stageId\" from \"Dunning\" where id='dun1'")
EXP=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select id from \"DunningStage\" where \"orgId\"='org1' and \"order\"=1")
[ -n "$ST" ] && [ "$ST" = "$EXP" ] || fail "Dunning dun1 hat stageId '$ST', erwartet Stufe order=1 ('$EXP')"
echo "    ok — Backfill vollstaendig, Legacy-Quotes q1/q2 (CONVERTED) nach ACCEPTED migriert, q3 (SENT) unveraendert"

echo "==> Fall 7 (Phase 5): FinalInvoiceDeduction — Insert + Unique-Constraint"
docker exec -i "$CONTAINER" psql -U oig -d openinvoice -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO "Invoice" ("id","orgId","customerId","number","status","type","prepaidCents","payableCents","updatedAt")
  VALUES ('dp1','org1','cust1','RE-2026-00002','FINALIZED','DOWNPAYMENT',0,NULL,NOW());
INSERT INTO "Invoice" ("id","orgId","customerId","number","status","type","prepaidCents","payableCents","updatedAt")
  VALUES ('fin1','org1','cust1','RE-2026-00003','FINALIZED','FINAL',357000,833000,NOW());
INSERT INTO "FinalInvoiceDeduction"
  ("id","finalInvoiceId","downpaymentInvoiceId","number","issueDate","netCents","taxCents","grossCents","taxRate","taxCategory")
  VALUES ('fid1','fin1','dp1','RE-2026-00002',NOW(),300000,57000,357000,19,'S');
SQL
FIDCOUNT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from \"FinalInvoiceDeduction\" where id='fid1'")
[ "$FIDCOUNT" = "1" ] || fail "FinalInvoiceDeduction-Zeile wurde nicht angelegt"
if docker exec -i "$CONTAINER" psql -U oig -d openinvoice -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null 2>&1
INSERT INTO "FinalInvoiceDeduction"
  ("id","finalInvoiceId","downpaymentInvoiceId","number","issueDate","netCents","taxCents","grossCents","taxRate","taxCategory")
  VALUES ('fid2','fin1','dp1','RE-2026-00002',NOW(),300000,57000,357000,19,'S');
SQL
then
  fail "zweite FinalInvoiceDeduction-Zeile mit gleichem (finalInvoiceId, downpaymentInvoiceId, taxRate, taxCategory) haette am Unique-Constraint scheitern muessen"
fi
echo "    ok — FinalInvoiceDeduction angelegt, Duplikat (finalInvoiceId, downpaymentInvoiceId, taxRate, taxCategory) vom Unique-Constraint abgewiesen"

echo "==> Fall 8 (Phase 6): Mahnwesen/Scheduler — Migrationen, Unique-Index, Defaults"
PHASE6MIG=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from _prisma_migrations where migration_name in ('20260904021504_phase6_dunning','20260904031045_phase6_scheduler_lock') and finished_at is not null")
[ "$PHASE6MIG" = "2" ] || fail "erwartet beide Phase-6-Migrationen als angewendet in _prisma_migrations, gefunden $PHASE6MIG"
for TBL in DunningStage DunningSettings SchedulerRun SchedulerLock; do
  EXISTS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select to_regclass('\"$TBL\"') is not null")
  [ "$EXISTS" = "t" ] || fail "Tabelle $TBL fehlt nach deploy"
done
DUNIDX=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from pg_indexes where indexname='Dunning_invoiceId_stageId_key'")
[ "$DUNIDX" = "1" ] || fail "Unique-Index Dunning_invoiceId_stageId_key fehlt nach deploy"
AUTOSENDDEFAULT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select column_default from information_schema.columns where table_name='DunningStage' and column_name='autoSend'")
[ "$AUTOSENDDEFAULT" = "false" ] || fail "DunningStage.autoSend hat Default '$AUTOSENDDEFAULT', erwartet false"
# DunningSettings entsteht per Selbstheilung (loadDunningSettings, upsert) — keine SQL-seitige
# Row hier; geprueft werden Tabellen-Existenz + Spalten-Defaults, nicht ein tatsaechlicher
# Datensatz (siehe Task-5-Facts).
DS_AUTOCREATE=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select column_default from information_schema.columns where table_name='DunningSettings' and column_name='autoCreate'")
[ "$DS_AUTOCREATE" = "true" ] || fail "DunningSettings.autoCreate hat Default '$DS_AUTOCREATE', erwartet true"
DS_AUTOSEND=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select column_default from information_schema.columns where table_name='DunningSettings' and column_name='autoSend'")
[ "$DS_AUTOSEND" = "false" ] || fail "DunningSettings.autoSend hat Default '$DS_AUTOSEND', erwartet false"
DS_BASERATE=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select column_default from information_schema.columns where table_name='DunningSettings' and column_name='baseInterestRateBp'")
[ "$DS_BASERATE" = "127" ] || fail "DunningSettings.baseInterestRateBp hat Default '$DS_BASERATE', erwartet 127"
# Unique-Index (invoiceId, stageId) tatsaechlich erzwungen: dun1 (Fall 6) hat bereits eine
# stageId; eine zweite Mahnung derselben Rechnung auf derselbe Stufe muss scheitern.
DUN1STAGE=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select \"stageId\" from \"Dunning\" where id='dun1'")
if docker exec -i "$CONTAINER" psql -U oig -d openinvoice -v ON_ERROR_STOP=1 -q <<SQL >/dev/null 2>&1
INSERT INTO "Dunning" ("id","invoiceId","level","stageId") VALUES ('dun2','inv1',1,'$DUN1STAGE');
SQL
then
  fail "zweite Dunning-Zeile mit gleichem (invoiceId, stageId) haette am Unique-Constraint scheitern muessen"
fi
echo "    ok — beide Phase-6-Migrationen angewendet, DunningStage/DunningSettings/SchedulerRun/SchedulerLock vorhanden, Unique-Index Dunning(invoiceId,stageId) erzwungen, autoSend-Defaults korrekt (Stufe false, Settings-Spalten autoCreate=true/autoSend=false/baseInterestRateBp=127)"

echo "==> Fall 9 (Phase 7): DocumentSettings-Defaults fuer Bestandszeile, neue Tabellen, Customer-Index"
# Eigenes Bestands-Szenario: DB exakt auf dem Stand VOR der Phase-7-Migration bringen
# (0_init + alle Migrationen bis einschliesslich Phase 6, jede einzeln per db execute
# angewendet und per "migrate resolve --applied" verbucht — KEIN "migrate deploy", das
# wuerde alle ausstehenden Migrationen inkl. Phase 7 in einem Rutsch anwenden). Danach
# eine Organisation + eine DocumentSettings-Zeile im ALTEN Spaltenumfang anlegen und erst
# dann per "migrate deploy" genau die Phase-7-Migration nachziehen — so laesst sich
# pruefen, dass ALTER TABLE ... ADD COLUMN ... DEFAULT die neuen Spalten auch auf einer
# bereits existierenden Zeile korrekt befuellt (nicht nur auf frisch angelegten Zeilen).
docker exec "$CONTAINER" psql -U oig -d openinvoice \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
npx prisma db execute --url "$DATABASE_URL" \
  --file prisma/migrations-postgres/0_init/migration.sql >/dev/null
npx prisma migrate resolve --config prisma.postgres.config.ts --applied 0_init >/dev/null
for MIG in $(ls prisma/migrations-postgres | grep -v -E '^(0_init|migration_lock\.toml|20260904044136_phase7_settings)$' | sort); do
  npx prisma db execute --url "$DATABASE_URL" \
    --file "prisma/migrations-postgres/$MIG/migration.sql" >/dev/null
  npx prisma migrate resolve --config prisma.postgres.config.ts --applied "$MIG" >/dev/null
done
docker exec -i "$CONTAINER" psql -U oig -d openinvoice -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO "Organization" ("id","legalName","addressLine1","postalCode","city","updatedAt")
  VALUES ('org9','Bestand GmbH','Altweg 9','99999','Bestadt',NOW());
INSERT INTO "DocumentSettings" ("id","orgId","onQuoteAccept","shareLinkDays","storeAcceptIp","updatedAt")
  VALUES ('ds9','org9','NONE',30,false,NOW());
SQL
npx prisma migrate deploy --config prisma.postgres.config.ts >/dev/null \
  || fail "Phase-7-Migration ist auf der Bestands-DB fehlgeschlagen"
PHASE7MIG=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from _prisma_migrations where migration_name='20260904044136_phase7_settings' and finished_at is not null")
[ "$PHASE7MIG" = "1" ] || fail "Phase-7-Migration ist nicht als angewendet verbucht"
DUEDAYS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"invoiceDueDays\" from \"DocumentSettings\" where id='ds9'")
[ "$DUEDAYS" = "14" ] || fail "Bestandszeile ds9: invoiceDueDays ist '$DUEDAYS', erwartet Default 14"
CURRENCY=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"defaultCurrency\" from \"DocumentSettings\" where id='ds9'")
[ "$CURRENCY" = "EUR" ] || fail "Bestandszeile ds9: defaultCurrency ist '$CURRENCY', erwartet Default EUR"
QVALID=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"quoteValidityDays\" from \"DocumentSettings\" where id='ds9'")
[ "$QVALID" = "30" ] || fail "Bestandszeile ds9: quoteValidityDays ist '$QVALID', erwartet Default 30"
BOOLDEFAULTS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"autoFinalizeOnSend\",\"shareLinkDefaultOn\",\"dnShowPrices\",\"dnShowArticleNumber\",\"dnShowDeliveryAddress\",\"showPaymentTermsText\",\"autoDeliveryDate\",\"refreshIssueDateOnFinalize\",\"offerLastDocument\",\"eInvoiceDefault\",\"recurringAutoFinalizeDefault\",\"recurringAutoSendDefault\",\"recurringInsertPeriodText\" from \"DocumentSettings\" where id='ds9'")
[ "$BOOLDEFAULTS" = "f|t|f|t|t|t|t|t|t|t|f|f|t" ] \
  || fail "Bestandszeile ds9: Bool-Defaults abweichend ('$BOOLDEFAULTS')"
PMID=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select \"defaultPaymentMethodId\" from \"DocumentSettings\" where id='ds9'")
[ -z "$PMID" ] || fail "Bestandszeile ds9: defaultPaymentMethodId ist '$PMID', erwartet NULL"
for TBL in BrandingSettings PrintSettings; do
  EXISTS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select to_regclass('\"$TBL\"') is not null")
  [ "$EXISTS" = "t" ] || fail "Tabelle $TBL fehlt nach der Phase-7-Migration"
done
ROWS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select (select count(*) from \"BrandingSettings\") + (select count(*) from \"PrintSettings\")")
[ "$ROWS" = "0" ] || fail "BrandingSettings/PrintSettings haben bereits Zeilen ($ROWS) — diese entstehen erst per Selbstheilung zur Laufzeit, nicht per Migration"
CUSTIDX=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from pg_indexes where indexname='Customer_orgId_customerNumber_idx'")
[ "$CUSTIDX" = "1" ] || fail "Index Customer_orgId_customerNumber_idx fehlt nach der Phase-7-Migration"
for COL in Invoice:printOptionsJson Quote:printOptionsJson DeliveryNote:printOptionsJson; do
  TBL=${COL%%:*}; CNAME=${COL##*:}
  PRESENT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
    "select count(*) from information_schema.columns where table_name='$TBL' and column_name='$CNAME'")
  [ "$PRESENT" = "1" ] || fail "Spalte $TBL.$CNAME fehlt nach der Phase-7-Migration"
done
echo "    ok — Phase-7-Migration auf einer Bestands-DB angewendet, DocumentSettings-Bestandszeile hat alle neuen Defaults, BrandingSettings/PrintSettings existieren (leer), Customer-Index und printOptionsJson-Spalten vorhanden"

echo "==> Fall 10 (Fix-Welle B3/S1): NumberRange.isActive-Default, Customer.defaultPaymentTermsDays nullable, aktive-Zeile-Switch"
ISACTIVE_DEFAULT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select column_default from information_schema.columns where table_name='NumberRange' and column_name='isActive'")
echo "$ISACTIVE_DEFAULT" | grep -q "^true" || fail "NumberRange.isActive hat Default '$ISACTIVE_DEFAULT', erwartet true"
PTD_NULLABLE=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select is_nullable from information_schema.columns where table_name='Customer' and column_name='defaultPaymentTermsDays'")
[ "$PTD_NULLABLE" = "YES" ] || fail "Customer.defaultPaymentTermsDays ist NOT NULL, erwartet nullable (B3-Fix-Welle S1)"
PTD_DEFAULT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select column_default from information_schema.columns where table_name='Customer' and column_name='defaultPaymentTermsDays'")
[ -z "$PTD_DEFAULT" ] || fail "Customer.defaultPaymentTermsDays hat noch einen DB-Default ('$PTD_DEFAULT'), erwartet keinen (NULL = kein Kunden-Override)"
# Aktive-Zeile-Switch (wie updateNumberRange ihn erzeugt): zwei Zeilen desselben docType
# (year 0 und year <Jahr>) — nur eine darf gleichzeitig aktiv sein, isActive schaltet um.
docker exec -i "$CONTAINER" psql -U oig -d openinvoice -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
INSERT INTO "NumberRange" ("id","orgId","docType","year","currentValue","isActive","updatedAt")
  VALUES ('nr1','org9','INVOICE',0,4999,true,NOW());
INSERT INTO "NumberRange" ("id","orgId","docType","year","currentValue","isActive","updatedAt")
  VALUES ('nr2','org9','INVOICE',2026,0,false,NOW());
UPDATE "NumberRange" SET "isActive" = false WHERE id = 'nr1';
UPDATE "NumberRange" SET "isActive" = true WHERE id = 'nr2';
SQL
ACTIVE_COUNT=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select count(*) from \"NumberRange\" where \"orgId\"='org9' and \"docType\"='INVOICE' and \"isActive\"=true")
[ "$ACTIVE_COUNT" = "1" ] || fail "erwartet genau 1 aktive NumberRange-Zeile nach dem Switch, gefunden $ACTIVE_COUNT"
ACTIVE_YEAR=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc \
  "select year from \"NumberRange\" where \"orgId\"='org9' and \"docType\"='INVOICE' and \"isActive\"=true")
[ "$ACTIVE_YEAR" = "2026" ] || fail "aktive Zeile hat year='$ACTIVE_YEAR', erwartet 2026 nach dem Switch"
echo "    ok — NumberRange.isActive Default true, Customer.defaultPaymentTermsDays nullable ohne Default, aktive-Zeile-Switch (year 0 -> year <Jahr>) funktioniert"

echo "ALLE TESTS BESTANDEN"
