import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { buildTemplateContext, sampleTemplateContext, DocumentNotFoundError } from "@/domain/email/context";
import { renderTemplate } from "@/lib/template/render";
import { EmailDocType } from "@/schemas/email";

export const runtime = "nodejs";

const bodySchema = z.object({
  docType: EmailDocType,
  docId: z.string().min(1).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  signature: z.string().default(""),
  sample: z.boolean().default(false),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validierung fehlgeschlagen: " + parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { docType, docId, subject, body, signature, sample } = parsed.data;

  try {
    let ctx;
    if (sample || !docId) {
      ctx = sampleTemplateContext(docType);
    } else {
      const org = await getActiveOrg();
      ctx = (await buildTemplateContext(org.id, docType, docId)).ctx;
    }

    const subj = renderTemplate(subject, ctx);
    const bod = renderTemplate(body, ctx);
    const sig = renderTemplate(signature, ctx);
    const warnings = [...subj.warnings, ...bod.warnings, ...sig.warnings];
    const renderedBody = sig.text.trim() ? `${bod.text}\n\n${sig.text}` : bod.text;

    return NextResponse.json({ subject: subj.text, body: renderedBody, warnings });
  } catch (e) {
    if (e instanceof DocumentNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("POST /api/emails/preview:", e);
    return NextResponse.json({ error: "Vorschau fehlgeschlagen." }, { status: 500 });
  }
}
