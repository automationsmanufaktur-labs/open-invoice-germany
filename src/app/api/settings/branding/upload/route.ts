import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { storeFile, AttachmentValidationError } from "@/lib/attachments/storage";
import { loadBrandingSettings, saveBrandingSettings } from "@/domain/settings/branding";

export const runtime = "nodejs";

const KIND_LIMITS_BYTES: Record<"logo" | "background", number> = {
  logo: 2 * 1024 * 1024,
  background: 5 * 1024 * 1024,
};

const kindSchema = z.enum(["logo", "background"]);

// Toleranz fuer multipart-Overhead (Boundary, Feldnamen) — analog api/attachments.
const CONTENT_LENGTH_TOLERANCE_BYTES = 16 * 1024;

/**
 * Logo-/Hintergrund-Upload fuers Briefpapier (§35, Task-4-Facts): multipart/form-data,
 * Feld `file` + `kind` (logo|background). Magic-Bytes/Endungspruefung ueber
 * storeFile (src/lib/attachments/storage.ts) — nur PNG/JPEG erlaubt (kein PDF/Text
 * fuer ein Logo). Alte Datei wird NICHT geloescht (Dedup-Speicher, Facts-Ruling) —
 * nur der Pfad in BrandingSettings wird auf den neuen Wert gesetzt.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const kindResult = kindSchema.safeParse(url.searchParams.get("kind"));
  if (!kindResult.success) {
    return NextResponse.json({ error: "kind muss 'logo' oder 'background' sein." }, { status: 400 });
  }
  const kind = kindResult.data;
  const limitBytes = KIND_LIMITS_BYTES[kind];

  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength > limitBytes + CONTENT_LENGTH_TOLERANCE_BYTES) {
    return NextResponse.json({ error: `Datei ueberschreitet die Groesse von ${limitBytes / (1024 * 1024)} MB.` }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ungueltige multipart-Anfrage." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei uebergeben (Feld 'file')." }, { status: 400 });
  }
  if (file.size > limitBytes) {
    return NextResponse.json({ error: `Datei ueberschreitet die Groesse von ${limitBytes / (1024 * 1024)} MB.` }, { status: 413 });
  }
  const mime = file.type || "application/octet-stream";
  if (mime !== "image/png" && mime !== "image/jpeg") {
    return NextResponse.json({ error: "Nur PNG oder JPEG sind fuer Logo/Hintergrund erlaubt." }, { status: 400 });
  }

  try {
    const org = await getActiveOrg();
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storeFile(org.id, buffer, mime, file.name);
    const current = await loadBrandingSettings(org.id);
    const settings = await saveBrandingSettings(org.id, {
      ...current,
      [kind === "logo" ? "logoPath" : "backgroundPath"]: stored.storagePath,
    });
    return NextResponse.json({ settings }, { status: 201 });
  } catch (e) {
    if (e instanceof AttachmentValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("POST /api/settings/branding/upload:", e);
    return NextResponse.json({ error: "Datei konnte nicht gespeichert werden." }, { status: 500 });
  }
}

/** Setzt den Pfad (logo/background) auf null zurueck — loescht die physische Datei NICHT (Dedup). */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const kindResult = kindSchema.safeParse(url.searchParams.get("kind"));
  if (!kindResult.success) {
    return NextResponse.json({ error: "kind muss 'logo' oder 'background' sein." }, { status: 400 });
  }
  const kind = kindResult.data;

  try {
    const org = await getActiveOrg();
    const current = await loadBrandingSettings(org.id);
    const settings = await saveBrandingSettings(org.id, {
      ...current,
      [kind === "logo" ? "logoPath" : "backgroundPath"]: null,
    });
    return NextResponse.json({ settings });
  } catch (e) {
    console.error("DELETE /api/settings/branding/upload:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
