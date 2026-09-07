import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { SettingsTabs } from "@/components/SettingsTabs";
import { TextTemplateForm } from "@/components/forms/TextTemplateForm";
import type { EmailDocType } from "@/schemas/email";

export const dynamic = "force-dynamic";

export default async function TextTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  const template = id === "neu" ? null : await dbInternal.textTemplate.findFirst({ where: { id, orgId: org.id } });
  if (id !== "neu" && !template) notFound();

  return (
    <div className="space-y-6">
      <SettingsTabs active="textvorlagen" />
      <div className="flex items-center gap-3">
        <Link href="/einstellungen/textvorlagen" className="text-sm text-slate-500 hover:text-slate-800">
          ← Dokumenttexte
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{template ? "Vorlage bearbeiten" : "Neue Vorlage"}</h1>
      </div>

      <TextTemplateForm template={template ? { ...template, docType: template.docType as EmailDocType } : null} />
    </div>
  );
}
