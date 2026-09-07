import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { SettingsTabs } from "@/components/SettingsTabs";
import { EmailTemplateForm } from "@/components/forms/EmailTemplateForm";
import type { EmailDocType } from "@/schemas/email";

export const dynamic = "force-dynamic";

export default async function EmailTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  const template =
    id === "neu"
      ? null
      : await dbInternal.emailTemplate.findFirst({ where: { id, orgId: org.id } });
  if (id !== "neu" && !template) notFound();

  return (
    <div className="space-y-6">
      <SettingsTabs active="vorlagen" />
      <div className="flex items-center gap-3">
        <Link href="/einstellungen/vorlagen" className="text-sm text-slate-500 hover:text-slate-800">
          ← Textvorlagen
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{template ? "Vorlage bearbeiten" : "Neue Vorlage"}</h1>
      </div>

      <EmailTemplateForm template={template ? { ...template, docType: template.docType as EmailDocType } : null} />
    </div>
  );
}
