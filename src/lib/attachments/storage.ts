/**
 * Dateiablage fuer Beleganhaenge (Phase 4b, Lastenheft §38): ausserhalb des Web-Roots,
 * Pfad `<ATTACHMENTS_DIR>/<orgId>/<sha256[0:2]>/<sha256>` — org-getrennt, kein Bezug zur
 * urspruenglichen Dateiendung im Pfad (Endung/Filename bleiben nur in der DB-Zeile).
 * Dedup: derselbe Inhalt landet je Org immer unter demselben Pfad (Hash-Adressierung) —
 * ein zweites Speichern desselben Inhalts schreibt nichts erneut (idempotent).
 *
 * `ATTACHMENTS_DIR` (Default `./data/attachments`, relativ zu `process.cwd()`, im
 * Container `/app/data/attachments`) wird bei jedem Aufruf frisch aus `process.env`
 * gelesen — Storage-Tests setzen die Variable je Testlauf auf ein `fs.mkdtemp`-Verzeichnis.
 */
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extensionMatchesMime, sniffMime, MAX_ATTACHMENT_FILE_BYTES, validateFileContent } from "@/lib/attachments/mime";

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

function attachmentsRoot(): string {
  const dir = process.env.ATTACHMENTS_DIR || "./data/attachments";
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

/** Pfad IM Speicher (nicht absolut auf dem Host) — das ist der Wert, der in
 *  DocumentAttachment.storagePath landet, damit ein Umzug von ATTACHMENTS_DIR (z. B.
 *  Docker-Volume-Wechsel) bestehende Zeilen nicht invalidiert. */
export function relativeStoragePath(orgId: string, sha256: string): string {
  return path.posix.join(orgId, sha256.slice(0, 2), sha256);
}

function absolutePath(storagePath: string): string {
  return path.join(attachmentsRoot(), ...storagePath.split("/"));
}

export interface StoreFileResult {
  storagePath: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Validiert (Groesse, Whitelist-Endung, Magic-Bytes) und speichert eine Datei fuer eine
 * Organisation. Wirft `AttachmentValidationError` bei jeder Ablehnung — der Aufrufer
 * (src/domain/attachment/manage.ts) uebersetzt das in eine sprechende Fehlermeldung.
 */
export async function storeFile(orgId: string, buffer: Buffer, mime: string, filename: string): Promise<StoreFileResult> {
  if (buffer.length === 0) throw new AttachmentValidationError("Datei ist leer.");
  if (buffer.length > MAX_ATTACHMENT_FILE_BYTES) {
    throw new AttachmentValidationError(`Datei ueberschreitet die Groesse von ${MAX_ATTACHMENT_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  if (!extensionMatchesMime(filename, mime)) {
    throw new AttachmentValidationError(`Dateiendung von "${filename}" passt nicht zum Typ "${mime}".`);
  }
  const check = validateFileContent(buffer, filename, mime);
  if (!check.ok) throw new AttachmentValidationError(check.reason);

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storagePath = relativeStoragePath(orgId, sha256);
  const abs = absolutePath(storagePath);

  // Dedup: existiert die Datei unter dem Hash-Pfad bereits (gleicher Inhalt, gleiche Org),
  // wird nicht erneut geschrieben.
  const exists = await fs
    .access(abs)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Erst in eine temporaere Datei im selben Verzeichnis schreiben, dann atomar umbenennen
    // — verhindert einen halb geschriebenen Anhang bei einem Absturz waehrend des Schreibens.
    // Der Temp-Name traegt einen Zufallsanteil: zwei gleichzeitige Uploads desselben
    // Inhalts (gleicher Prozess, gleiche Millisekunde) duerfen sich nicht dieselbe
    // Temp-Datei teilen — sonst verliert der zweite `rename` mit ENOENT.
    const tmp = `${abs}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tmp, buffer);
    try {
      await fs.rename(tmp, abs);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      // Hat ein paralleler Upload die Zieldatei inzwischen angelegt, ist der Inhalt
      // (Hash-Adressierung) identisch — Dedup-Treffer, kein Fehler.
      const nowExists = await fs
        .access(abs)
        .then(() => true)
        .catch(() => false);
      if (!nowExists) throw err;
    }
  }

  return { storagePath, sha256, sizeBytes: buffer.length };
}

/** Liest eine gespeicherte Datei. Der Aufrufer muss VORHER pruefen, dass storagePath aus
 *  einer org-geprueften DocumentAttachment-Zeile stammt (kein direkter Nutzerinput). */
export async function readFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(absolutePath(storagePath));
}

/**
 * Loescht die physische Datei NUR, wenn keine andere DocumentAttachment-Zeile denselben
 * storagePath referenziert (mehrere Belege koennen denselben Inhalt referenzieren, Dedup).
 * `isReferenced` kapselt die DB-Pruefung — bleibt hier bewusst injizierbar, damit dieses
 * Modul keine Prisma-Abhaengigkeit braucht (reine Dateisystem-Funktion, leichter zu testen).
 */
export async function deleteFileIfUnreferenced(storagePath: string, isReferenced: (storagePath: string) => Promise<boolean>): Promise<void> {
  if (await isReferenced(storagePath)) return;
  await fs.rm(absolutePath(storagePath), { force: true });
}

// Re-Export fuer Aufrufer, die nur die Magic-Bytes-Erkennung brauchen (z. B. Tests).
export { sniffMime };
