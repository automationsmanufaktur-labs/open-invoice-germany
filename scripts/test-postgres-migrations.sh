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
[ "$COUNT" = "28" ] || fail "erwartet 28 Tabellen, gefunden $COUNT"
echo "    ok — 28 Tabellen angelegt"

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
echo "    ok — Baseline verbucht, Folgemigrationen angewendet, deploy idempotent, MailSettings/EmailTemplate-Index vorhanden"

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
[ "$PM" = "8" ] || fail "erwartet 8 Zahlungsmethoden, gefunden $PM"
DS=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select count(*) from \"DunningStage\" where \"orgId\"='org1'")
[ "$DS" = "4" ] || fail "erwartet 4 Mahnstufen, gefunden $DS"
ST=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select \"stageId\" from \"Dunning\" where id='dun1'")
EXP=$(docker exec "$CONTAINER" psql -U oig -d openinvoice -tAc "select id from \"DunningStage\" where \"orgId\"='org1' and \"order\"=1")
[ -n "$ST" ] && [ "$ST" = "$EXP" ] || fail "Dunning dun1 hat stageId '$ST', erwartet Stufe order=1 ('$EXP')"
echo "    ok — Backfill vollstaendig, Legacy-Quotes q1/q2 (CONVERTED) nach ACCEPTED migriert, q3 (SENT) unveraendert"

echo "ALLE TESTS BESTANDEN"
