#!/bin/sh
# Startet die Anwendung. Datenbankpruefung und Migrationen liegen in db-prepare.sh,
# damit sie ohne Anwendungsstart testbar sind.
set -eu
sh ./scripts/db-prepare.sh
exec npx next start -p 3000
