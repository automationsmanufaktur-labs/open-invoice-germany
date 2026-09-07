import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { dbInternal } from "@/lib/db";
import { removeAttachment, type AttachmentDocType } from "@/domain/attachment/manage";
import { readFile } from "@/lib/attachments/storage";
import { NotFoundError } from "@/domain/errors";
import { contentDispositionAttachment } from "@/lib/http/content-disposition";

export const runtime = "nodejs";

/** Beleganhang herunterladen — org-geprueft, Content-Disposition: attachment, no-store. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const row = await dbInternal.documentAttachment.findFirst({ where: { id, orgId: org.id } });
    if (!row) return NextResponse.json({ error: "Anhang nicht gefunden." }, { status: 404 });

    const buffer = await readFile(row.storagePath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": row.mime,
        "content-disposition": contentDispositionAttachment(row.filename),
        "content-length": String(row.sizeBytes),
        "cache-control": "no-store",
        // W1: verhindert, dass der Browser den vom Client gemeldeten MIME-Typ ignoriert
        // und den Anhang anhand des Inhalts als etwas anderes (z. B. HTML) interpretiert.
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error("GET /api/attachments/[id]:", e);
    return NextResponse.json({ error: "Anhang konnte nicht gelesen werden." }, { status: 500 });
  }
}

/** Beleganhang loeschen — kein GoBD-Beleg (loeschbar), Aktion geht ins ChangeLog. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const row = await dbInternal.documentAttachment.findFirst({ where: { id, orgId: org.id } });
    if (!row) return NextResponse.json({ error: "Anhang nicht gefunden." }, { status: 404 });

    await removeAttachment(org.id, row.docType as AttachmentDocType, row.docId, id, actor);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("DELETE /api/attachments/[id]:", e);
    return NextResponse.json({ error: "Anhang konnte nicht geloescht werden." }, { status: 500 });
  }
}
