/**
 * Prisma-Client mit GoBD-Unveränderbarkeits-Guard.
 *
 * `prisma`      — allgemeiner Client (API-Routes, UI). Blockt update/delete an
 *                 festgeschriebenen Rechnungen/Positionen (status !== DRAFT).
 * `dbInternal`  — ungeschützter Client. NUR in geprüften Domain-Services
 *                 (finalize, cancel, recordPayment) verwenden, die kontrollierte
 *                 Statuswechsel vornehmen.
 */
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Löst einen relativen SQLite-`file:`-Pfad in einen ABSOLUTEN Pfad auf.
 * Notwendig, weil der von Bundlern (Next/Turbopack) gebündelte Client das
 * relative `./dev.db` sonst relativ zum Bundle statt zum Schema-Verzeichnis
 * auflöst. Die Prisma-CLI ankert relative Pfade am Schema-Verzeichnis (prisma/)
 * — das spiegeln wir hier. PostgreSQL-/absolute URLs bleiben unverändert.
 */
function resolveDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return url;
  const filePath = url.slice("file:".length);
  if (path.isAbsolute(filePath)) return url;
  const abs = path.resolve(process.cwd(), "prisma", filePath.replace(/^\.\//, ""));
  return `file:${abs}`;
}

/**
 * Case-insensitiver "contains"-Filter, portabel ueber SQLite und Postgres (Phase
 * 8b, Ruling Task-1-Facts). SQLite `contains` ist fuer ASCII bereits case-
 * insensitiv (Datenbank-Collation), `mode: "insensitive"` ist dort ein
 * Laufzeitfehler (Prisma unterstuetzt den Modus nur bei Postgres) — deshalb wird
 * `mode` NUR gesetzt, wenn der Provider Postgres ist (erkannt am Praefix von
 * `DATABASE_URL`, analog `resolveDatasourceUrl` oben).
 */
export function ciContains(value: string): { contains: string; mode?: "insensitive" } {
  const url = process.env.DATABASE_URL ?? "";
  const isPostgres = url.startsWith("postgres");
  return isPostgres ? { contains: value, mode: "insensitive" } : { contains: value };
}

export class GobdImmutabilityError extends Error {
  constructor(public readonly ref: string) {
    super(
      `GoBD: Festgeschriebene Rechnung "${ref}" ist unveränderbar. ` +
        `Korrektur nur per Storno oder Korrekturrechnung (§ 146 Abs. 4 AO).`,
    );
    this.name = "GobdImmutabilityError";
  }
}

const globalForPrisma = globalThis as unknown as { __oigBase?: PrismaClient };
const datasourceUrl = resolveDatasourceUrl();
const base = globalForPrisma.__oigBase ?? new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);
if (process.env.NODE_ENV !== "production") globalForPrisma.__oigBase = base;

/** Ungeschützter Basis-Client — nur intern. */
export const dbInternal = base;

async function guardInvoiceWhere(where: unknown): Promise<void> {
  const rows = await base.invoice.findMany({
    where: (where ?? {}) as never,
    select: { id: true, number: true, status: true },
  });
  const locked = rows.find((r) => r.status !== "DRAFT");
  if (locked) throw new GobdImmutabilityError(locked.number ?? locked.id);
}

/**
 * B9 (Fix-Welle): `FinalInvoiceDeduction` ist der Abzugs-Snapshot einer Schlussrechnung
 * (Abschn. 14.8 UStAE) — genauso unveraenderlich wie die Rechnung/Zeilen selbst, aber
 * bisher ohne Guard (anders als `invoice`/`invoiceLine`). Anders als dort gibt es keinen
 * DRAFT-Status, ueber den eine Aenderung je legitim waere: die Zeilen werden
 * ausschliesslich einmalig innerhalb von `finalizeWithinTx` per `createMany` auf dem
 * ungeschuetzten `dbInternal`/Transaktions-Client geschrieben — ueber den geschuetzten
 * `prisma`-Client sind update/delete/updateMany/deleteMany deshalb IMMER verboten.
 */
class FinalInvoiceDeductionImmutabilityError extends Error {
  constructor() {
    super(
      "GoBD: FinalInvoiceDeduction ist ein unveraenderlicher Abzugs-Snapshot der Schlussrechnung " +
        "und kann nicht nachtraeglich geaendert oder geloescht werden (Abschn. 14.8 UStAE).",
    );
    this.name = "FinalInvoiceDeductionImmutabilityError";
  }
}

async function guardLineWhere(where: unknown): Promise<void> {
  const rows = await base.invoiceLine.findMany({
    where: (where ?? {}) as never,
    select: { id: true, invoice: { select: { id: true, number: true, status: true } } },
  });
  const locked = rows.find((r) => r.invoice.status !== "DRAFT");
  if (locked) throw new GobdImmutabilityError(locked.invoice.number ?? locked.invoice.id);
}

/**
 * Phase 6: `Dunning` ist ein Geschaeftsbrief (GoBD) — nach Erstellung unveraenderlich,
 * analog `FinalInvoiceDeduction`. Zwei Ausnahmen bleiben ueber den geschuetzten Client
 * erlaubt, weil sie keinen inhaltlichen Beleg-Bestandteil aendern: `sentAt` (tatsaechlicher
 * Versandzeitpunkt, erst nach dem Mailversand bekannt) und `pdfPath` (Ablagepfad des
 * einmalig erzeugten PDFs, erst nach dessen Erstellung bekannt). Jeder andere Schluessel
 * in `data` wird verweigert; delete/deleteMany sind — wie bei FinalInvoiceDeduction —
 * IMMER verboten.
 */
const DUNNING_MUTABLE_KEYS = new Set(["sentAt", "pdfPath"]);

class DunningImmutabilityError extends Error {
  constructor(badKeys: string[]) {
    super(
      `GoBD: Mahnung ist nach Erstellung unveraenderlich (Geschaeftsbrief). Nur sentAt/pdfPath ` +
        `duerfen nachtraeglich gesetzt werden, nicht: ${badKeys.join(", ")}.`,
    );
    this.name = "DunningImmutabilityError";
  }
}

function assertDunningUpdateAllowed(data: unknown): void {
  const keys = Object.keys((data ?? {}) as Record<string, unknown>);
  const badKeys = keys.filter((k) => !DUNNING_MUTABLE_KEYS.has(k));
  if (badKeys.length > 0) throw new DunningImmutabilityError(badKeys);
}

export const prisma = base.$extends({
  query: {
    invoice: {
      async update({ args, query }) {
        await guardInvoiceWhere(args.where);
        return query(args);
      },
      async delete({ args, query }) {
        await guardInvoiceWhere(args.where);
        return query(args);
      },
      async updateMany({ args, query }) {
        await guardInvoiceWhere(args.where);
        return query(args);
      },
      async deleteMany({ args, query }) {
        await guardInvoiceWhere(args.where);
        return query(args);
      },
      async upsert({ args, query }) {
        await guardInvoiceWhere(args.where);
        return query(args);
      },
    },
    invoiceLine: {
      async update({ args, query }) {
        await guardLineWhere(args.where);
        return query(args);
      },
      async delete({ args, query }) {
        await guardLineWhere(args.where);
        return query(args);
      },
      async updateMany({ args, query }) {
        await guardLineWhere(args.where);
        return query(args);
      },
      async deleteMany({ args, query }) {
        await guardLineWhere(args.where);
        return query(args);
      },
    },
    finalInvoiceDeduction: {
      async update() {
        throw new FinalInvoiceDeductionImmutabilityError();
      },
      async delete() {
        throw new FinalInvoiceDeductionImmutabilityError();
      },
      async updateMany() {
        throw new FinalInvoiceDeductionImmutabilityError();
      },
      async deleteMany() {
        throw new FinalInvoiceDeductionImmutabilityError();
      },
    },
    dunning: {
      async update({ args, query }) {
        assertDunningUpdateAllowed(args.data);
        return query(args);
      },
      async updateMany({ args, query }) {
        assertDunningUpdateAllowed(args.data);
        return query(args);
      },
      async delete() {
        throw new DunningImmutabilityError(["delete"]);
      },
      async deleteMany() {
        throw new DunningImmutabilityError(["deleteMany"]);
      },
    },
  },
});
