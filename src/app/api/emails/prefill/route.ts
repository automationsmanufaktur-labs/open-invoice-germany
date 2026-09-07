import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { prefillEmail } from "@/domain/email/compose";
import { DocumentNotFoundError } from "@/domain/email/context";
import { MailNotConfiguredError } from "@/domain/email/settings";
import { EmailDocType } from "@/schemas/email";

export const runtime = "nodejs";

const byDoc = z.object({
  docType: EmailDocType,
  docId: z.string().min(1),
  templateId: z.string().optional(),
});
const byLog = z.object({
  logId: z.string().min(1),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());

  const parsedByLog = byLog.safeParse(query);
  const parsedByDoc = byDoc.safeParse(query);
  if (!parsedByLog.success && !parsedByDoc.success) {
    return NextResponse.json({ error: "Ungueltige Parameter: docType/docId oder logId erforderlich" }, { status: 400 });
  }

  try {
    const org = await getActiveOrg();
    const source = parsedByLog.success ? { logId: parsedByLog.data.logId } : parsedByDoc.data!;
    const result = await prefillEmail(org.id, source);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof DocumentNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof MailNotConfiguredError) {
      return NextResponse.json({ error: "MAIL_NOT_CONFIGURED" }, { status: 409 });
    }
    console.error("GET /api/emails/prefill:", e);
    return NextResponse.json({ error: "Vorbelegung fehlgeschlagen." }, { status: 500 });
  }
}
