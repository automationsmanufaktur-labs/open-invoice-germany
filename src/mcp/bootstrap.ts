/**
 * Wird als ERSTES (vor dem Prisma-Import) geladen. Lädt .env und verankert einen
 * relativen SQLite-Pfad absolut am Projektverzeichnis — so läuft der MCP-Server
 * unabhängig vom Arbeitsverzeichnis, mit dem Claude Code ihn startet.
 * PostgreSQL-/absolute URLs bleiben unverändert.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const current = process.env.DATABASE_URL;
if (!current || current.startsWith("file:")) {
  const file = current ? current.replace(/^file:/, "") : "dev.db";
  const abs = path.isAbsolute(file) ? file : path.join(projectRoot, "prisma", path.basename(file));
  process.env.DATABASE_URL = `file:${abs}`;
}

export const PROJECT_ROOT = projectRoot;
