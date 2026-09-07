import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { addAttachment, type AttachmentDocType } from "@/domain/attachment/manage";
import { AttachmentValidationError } from "@/lib/attachments/storage";
import { RelationError } from "@/domain/relations";
import { DocRefType } from "@/schemas";
import { MAX_ATTACHMENT_FILE_BYTES, MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC } from "@/lib/attachments/mime";

export const runtime = "nodejs";

// Toleranz fuer multipart-Overhead (Boundary, Feldnamen) oberhalb der eigentlichen
// Dateigroesse — analog api/emails/send.
const CONTENT_LENGTH_TOLERANCE_BYTES = 64 * 1024;

const fieldsSchema = z.object({
  docType: DocRefType,
  docId: z.string().min(1),
});

interface SavedAttachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}
interface FailedAttachment {
  filename: string;
  error: string;
}

/** Ordnet einen Domain-Fehler einer Statuscode/Meldung zu (fuer den Fall, dass GAR
 *  nichts gespeichert wurde — dann bleibt der Gesamt-Statuscode wie bisher). */
function classifyError(e: unknown): { status: number; message: string } {
  if (e instanceof z.ZodError) {
    return { status: 400, message: "Validierung fehlgeschlagen: " + (e.issues[0]?.message ?? "") };
  }
  if (e instanceof AttachmentValidationError) {
    return { status: 400, message: e.message };
  }
  if (e instanceof RelationError) {
    return { status: 404, message: e.message };
  }
  if (e instanceof Error && e.message.includes("ueberschreiten insgesamt")) {
    return { status: 400, message: e.message };
  }
  console.error("POST /api/attachments:", e);
  return { status: 500, message: "Anhang konnte nicht gespeichert werden." };
}

export async function POST(req: Request) {
  // Groesse VOR jedem Einlesen anhand des Headers pruefen (analog api/emails/send) —
  // fehlt er oder ist er zu gross, wird der Body nie gelesen.
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength > MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC + CONTENT_LENGTH_TOLERANCE_BYTES) {
    return NextResponse.json({ error: "Anfrage zu gross" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ungueltige multipart-Anfrage." }, { status: 400 });
  }

  const parsedFields = fieldsSchema.safeParse({ docType: formData.get("docType"), docId: formData.get("docId") });
  if (!parsedFields.success) {
    return NextResponse.json({ error: "docType/docId fehlen oder sind ungueltig." }, { status: 400 });
  }
  const { docType, docId } = parsedFields.data as { docType: AttachmentDocType; docId: string };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Keine Datei uebergeben." }, { status: 400 });
  }

  let org: Awaited<ReturnType<typeof getActiveOrg>>;
  let actor: string;
  try {
    org = await getActiveOrg();
    actor = (await getCurrentUserId()) ?? "system";
  } catch (e) {
    console.error("POST /api/attachments:", e);
    return NextResponse.json({ error: "Anhang konnte nicht gespeichert werden." }, { status: 500 });
  }

  // Fix-Runde 1: ein fehlerhafter Anhang (z. B. falsches Format) darf die uebrigen
  // Dateien EINES Mehrfach-Uploads nicht blockieren — jede Datei wird einzeln versucht,
  // Erfolge und Fehlschlaege werden getrennt zurueckgegeben statt beim ersten Fehler
  // abzubrechen.
  const saved: SavedAttachment[] = [];
  const failed: FailedAttachment[] = [];
  let firstError: unknown = null;

  for (const f of files) {
    try {
      if (f.size > MAX_ATTACHMENT_FILE_BYTES) {
        throw new AttachmentValidationError(`Datei "${f.name}" ueberschreitet die Groesse von ${MAX_ATTACHMENT_FILE_BYTES / (1024 * 1024)} MB.`);
      }
      const buffer = Buffer.from(await f.arrayBuffer());
      const row = await addAttachment(org.id, docType, docId, { filename: f.name, mime: f.type || "application/octet-stream", buffer }, actor);
      saved.push({ id: row.id, filename: row.filename, mime: row.mime, sizeBytes: row.sizeBytes });
    } catch (e) {
      firstError ??= e;
      const { message } = classifyError(e);
      failed.push({ filename: f.name, error: message });
    }
  }

  if (saved.length === 0) {
    // Nichts gespeichert: Statuscode wie bisher (400/404/500), abgeleitet vom ersten Fehler.
    const { status, message } = classifyError(firstError);
    return NextResponse.json({ error: message }, { status });
  }

  // Voller Erfolg (201) vs. Teilerfolg (207) — der Client zeigt "failed" als Warnung an
  // und uebernimmt "saved" in die Anhangsliste.
  return NextResponse.json({ saved, failed }, { status: failed.length === 0 ? 201 : 207 });
}
