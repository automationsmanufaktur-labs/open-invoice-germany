// Prisma-Konfiguration fuer den PostgreSQL-Pfad (Docker/Produktion).
//
// Eigene Datei, weil migration_lock.toml den Provider festschreibt: SQLite- und
// Postgres-Migrationen koennen sich kein Verzeichnis teilen. Die CLI laedt
// prisma.config.ts automatisch aus dem Arbeitsverzeichnis — deren migrations.path
// zeigt auf die SQLite-Migrationen. Postgres-Befehle brauchen deshalb immer
// "--config prisma.postgres.config.ts".
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.postgres.prisma",
  migrations: {
    path: "prisma/migrations-postgres",
  },
  engine: "classic",
  datasource: {
    // Der Block ist Pflicht: ohne ihn bricht die CLI mit
    // "Cannot destructure property 'url'" ab. Ein Rueckfall auf env("DATABASE_URL")
    // aus dem Schema findet nicht statt.
    url: process.env.DATABASE_URL ?? "",
  },
});
