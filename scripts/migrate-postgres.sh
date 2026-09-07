#!/usr/bin/env bash
# Erzeugt eine PostgreSQL-Migration und stellt danach den SQLite-Client wieder her.
#
# Beide Schemadateien generieren den Prisma-Client in denselben Pfad
# (src/generated/prisma). "prisma migrate dev" erzeugt ihn am Ende neu — ohne den
# abschließenden "prisma generate"-Lauf bliebe der Postgres-Client liegen, und
# "npm test" sowie "npm run dev" scheiterten danach mit einem irreführenden
# Protokollfehler.
#
# Argumente werden an "migrate dev" durchgereicht:
#   npm run db:migrate:pg -- --name kunden_notizfeld
set -euo pipefail
cd "$(dirname "$0")/.."

# Der Client wird auch im Fehlerfall wiederhergestellt: "migrate dev" erzeugt ihn
# als einen seiner letzten Schritte, kann danach aber noch scheitern — dann läge
# ohne diesen Trap der Postgres-Client im SQLite-Pfad.
restore_sqlite_client() {
  local code=$?
  npx prisma generate || true
  exit "$code"
}
trap restore_sqlite_client EXIT

npx prisma migrate dev --config prisma.postgres.config.ts "$@"
