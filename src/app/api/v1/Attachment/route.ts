/**
 * /api/v1/Attachment — Beleganhaenge. Anders als die Session-Route `/api/attachments`
 * (multipart/form-data) nimmt die JSON-API den Dateiinhalt als `contentBase64` entgegen
 * (withApi parst den Body bereits als JSON, siehe src/api/auth.ts). Kein PATCH (Anhaenge
 * sind unveraenderlich — nur Anlegen/Auflisten in Task 2, Loeschen bleibt Task 3/UI).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeAttachment } from "@/api/serializers/attachment";
import { listAttachmentsApi, attachmentListFilterSchema } from "@/domain/attachment/list";
import { addAttachment } from "@/domain/attachment/manage";
import { DocRefType } from "@/schemas";
import { RelationError } from "@/domain/relations";
import { NotFoundError } from "@/domain/errors";
import { PayloadTooLargeError } from "@/api/errors";
import { MAX_ATTACHMENT_FILE_BYTES } from "@/lib/attachments/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fix-Welle (Should-fix 5): Base64 blaeht die Nutzlast um ~33 % auf (10 MB Datei ->
// ~13,3 MB Base64-Text); 16 MB Body-Limit laesst das volle Dateilimit (mime.ts,
// MAX_ATTACHMENT_FILE_BYTES) bequem zu, ohne einem beliebig grossen JSON-Body Tuer und
// Tor zu oeffnen (das allgemeine withApi-Default bleibt 2 MB fuer jede andere Route).
const ATTACHMENT_MAX_BODY_BYTES = 16 * 1024 * 1024;
// Base64 kodiert 3 Rohbytes in 4 Zeichen — diese Laenge (VOR dem Decode) muss geprueft
// werden, damit ein ueberdimensionierter Base64-String nicht erst komplett dekodiert
// wird, bevor storeFile() die Dateigroesse ablehnt (Buffer.from() alloziiert bereits den
// vollen dekodierten Puffer im Speicher).
const MAX_ATTACHMENT_BASE64_CHARS = Math.ceil((MAX_ATTACHMENT_FILE_BYTES * 4) / 3) + 4;

const createBodySchema = z.object({
  docType: DocRefType,
  docId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1),
  contentBase64: z.string().min(1),
});

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listAttachmentsApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeAttachment), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const v = createBodySchema.parse(ctx.body);
  if (v.contentBase64.length > MAX_ATTACHMENT_BASE64_CHARS) {
    throw new PayloadTooLargeError(`Anhang ueberschreitet die Groesse von ${MAX_ATTACHMENT_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  const buffer = Buffer.from(v.contentBase64, "base64");
  try {
    const created = await addAttachment(ctx.orgId, v.docType, v.docId, { filename: v.filename, mime: v.mime, buffer }, ctx.actor);
    return apiData(serializeAttachment(created), 201);
  } catch (e) {
    // RelationError ist NICHT im Registry-Fallback (siehe src/api/errors.ts) — Beleg
    // nicht gefunden/fremde Organisation ist hier ein 404, kein 409 (analog
    // src/app/api/attachments/route.ts classifyError).
    if (e instanceof RelationError) throw new NotFoundError(e.message);
    throw e;
  }
}, { scope: "write", maxBodyBytes: ATTACHMENT_MAX_BODY_BYTES });

export const spec = {
  list: {
    path: "/api/v1/Attachment",
    method: "GET",
    summary: "Beleganhaenge auflisten (optional nach docType/docId)",
    scope: "read",
    request: { query: attachmentListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/Attachment",
    method: "POST",
    summary: "Beleganhang hochladen (Base64)",
    scope: "write",
    request: { body: createBodySchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 404, 413, 429],
  },
} satisfies Record<string, RouteSpec>;
