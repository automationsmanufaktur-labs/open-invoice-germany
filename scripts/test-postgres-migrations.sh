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
[ "$COUNT" = "15" ] || fail "erwartet 15 Tabellen, gefunden $COUNT"
echo "    ok — 15 Tabellen angelegt"

echo "==> Datenbank leeren und Bestandslage herstellen"
docker exec "$CONTAINER" psql -U oig -d openinvoice \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
npx prisma db push --schema prisma/schema.postgres.prisma \
  --skip-generate --accept-data-loss >/dev/null

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
npx prisma migrate deploy --config prisma.postgres.config.ts 2>&1 \
  | grep -q "No pending migrations" || fail "deploy war nicht wirkungslos"
echo "    ok — Baseline verbucht, deploy wirkungslos"

echo "==> Fall 4: db-prepare.sh nach Baseline ist wirkungslos"
OUT=$(run_with_timeout 120 ./scripts/db-prepare.sh 2>&1) \
  || fail "db-prepare.sh haette mit Exit 0 durchlaufen sollen"
printf '%s' "$OUT" | grep -q "No pending migrations" \
  || fail "db-prepare.sh hat keine ausstehenden Migrationen gemeldet"
echo "    ok — db-prepare.sh laeuft nach Baseline sauber durch"

echo "ALLE TESTS BESTANDEN"
