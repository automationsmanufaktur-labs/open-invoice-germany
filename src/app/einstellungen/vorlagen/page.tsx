import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { SettingsTabs } from "@/components/SettingsTabs";
import { DOC_TYPE_LABEL } from "@/lib/email/doc-type-labels";
import { EMAIL_DOC_TYPES, type EmailDocType } from "@/schemas/email";
import { TemplateRowActions } from "@/components/forms/TemplateRowActions";

export const dynamic = "force-dynamic";

export default async function EmailTemplatesPage() {
  const org = await getActiveOrg();
  const templates = await dbInternal.emailTemplate.findMany({
    where: { orgId: org.id },
    orderBy: [{ docType: "asc" }, { name: "asc" }],
  });

  const byDocType = new Map<EmailDocType, typeof templates>();
  for (const t of templates) {
    const key = t.docType as EmailDocType;
    byDocType.set(key, [...(byDocType.get(key) ?? []), t]);
  }

  return (
    <div className="space-y-6">
      <SettingsTabs active="vorlagen" />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Textvorlagen</h1>
        <Link href="/einstellungen/vorlagen/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neue Vorlage
        </Link>
      </div>

      {EMAIL_DOC_TYPES.map((docType) => {
        const items = byDocType.get(docType) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={docType} className="space-y-2 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">{DOC_TYPE_LABEL[docType]}</h2>
            <div className="divide-y divide-slate-100">
              {items.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{t.name}</span>
                    {t.isDefault && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Standard</span>}
                    {t.isSystem && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">System</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/einstellungen/vorlagen/${t.id}`} className="text-indigo-600 hover:underline">
                      Bearbeiten
                    </Link>
                    <TemplateRowActions id={t.id} isDefault={t.isDefault} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
