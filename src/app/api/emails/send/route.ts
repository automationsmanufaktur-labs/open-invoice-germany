import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { sendDocumentEmail, EmailAttachmentsTooLargeError } from "@/domain/email/send";
import { DocumentNotFoundError } from "@/domain/email/context";
import { MailNotConfiguredError } from "@/domain/email/settings";
import { sendEmailInputSchema, type SendEmailRawInput } from "@/schemas/email";
import type { Attachment } from "@/domain/email/attachments";
import { MAX_ATTACHMENT_FILE_BYTES, MAX_EMAIL_EXTRA_ATTACHMENTS_TOTAL_BYTES } from "@/lib/attachments/mime";

export const runtime = "nodejs";

// Gemeinsame Groessenkonstanten mit den Beleganhaengen (src/lib/attachments/mime.ts,
// Auftrag Task 3: "nicht doppelt pflegen").
const MAX_FILE_BYTES = MAX_ATTACHMENT_FILE_BYTES;
const MAX_TOTAL_BYTES = MAX_EMAIL_EXTRA_ATTACHMENTS_TOTAL_BYTES;
// Toleranz fuer multipart-Overhead (Boundary, Feldnamen, payload-JSON) oberhalb der
// eigentlichen Anhangsgroesse.
const CONTENT_LENGTH_TOLERANCE_BYTES = 64 * 1024;
// Eigene, absichtlich ANDERE Whitelist als ATTACHMENT_MIME_WHITELIST (src/schemas/index.ts):
// Zusatzanhaenge zu einer Mail sind spontane Uploads (z. B. eine erzeugte XML-Datei),
// keine dauerhaften Beleganhaenge — bewusst kein Office-Dokumentenformat hier.
const MIME_WHITELIST = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/xml",
  "text/xml",
  "text/csv",
  "text/plain",
]);

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function POST(req: Request) {
  // Groesse VOR jedem Einlesen (auch vor DB-/Auth-Zugriff) anhand des Headers pruefen —
  // fehlt er oder ist er zu gross, wird der Body nie gelesen (W2).
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength > MAX_TOTAL_BYTES + CONTENT_LENGTH_TOLERANCE_BYTES) {
    return NextResponse.json({ error: "Anfrage zu gross" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ungueltige multipart-Anfrage." }, { status: 400 });
  }

  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    return NextResponse.json({ error: "Feld payload fehlt." }, { status: 400 });
  }
  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ error: "payload ist kein gueltiges JSON." }, { status: 400 });
  }
  // Grobpruefung fuer eine fruehe, verstaendliche 400-Antwort. Massgeblich fuer den
  // eigentlichen Versand ist der Parse-Aufruf INNERHALB von sendDocumentEmail (G5,
  // Lastenheft 55: kein Bypass ueber MCP) — das rohe payloadJson wird unveraendert
  // durchgereicht, nicht das hier bereits transformierte Ergebnis.
  const parsed = sendEmailInputSchema.safeParse(payloadJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validierung fehlgeschlagen: " + (parsed.error.issues[0]?.message ?? "") }, { status: 400 });
  }
  const rawPayload = payloadJson as SendEmailRawInput;

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  let totalBytes = 0;
  const extra: Attachment[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `Datei "${f.name}" ueberschreitet die Groesse von 10 MB.` }, { status: 400 });
    }
    totalBytes += f.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "Anhaenge ueberschreiten insgesamt 20 MB." }, { status: 400 });
    }
    const contentType = f.type || "application/octet-stream";
    if (!MIME_WHITELIST.has(contentType)) {
      return NextResponse.json({ error: `Dateityp "${contentType}" ist nicht erlaubt.` }, { status: 400 });
    }
    const buf = Buffer.from(await f.arrayBuffer());
    extra.push({ filename: sanitizeFilename(f.name), contentType, content: buf });
  }

  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const result = await sendDocumentEmail(org.id, actor, rawPayload, extra);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof DocumentNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof MailNotConfiguredError) {
      return NextResponse.json({ error: "MAIL_NOT_CONFIGURED" }, { status: 409 });
    }
    if (e instanceof EmailAttachmentsTooLargeError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("POST /api/emails/send:", e);
    return NextResponse.json({ error: "Versand fehlgeschlagen." }, { status: 500 });
  }
}
