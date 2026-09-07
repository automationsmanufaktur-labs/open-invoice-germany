import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { SettingsTabs } from "@/components/SettingsTabs";
import { DOC_TYPE_LABEL } from "@/lib/email/doc-type-labels";
import { TextTemplateRowActions } from "@/components/forms/TextTemplateRowActions";
import type { EmailDocType } from "@/schemas/email";

export const dynamic = "force-dynamic";

const DOC_TYPES: EmailDocType[] = ["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA", "DELIVERY_NOTE", "INVOICE"];
const POSITION_LABEL: Record<string, string> = {
  HEAD: "Kopftext",
  FOOT: "Fußtext",
  TERMS_DELIVERY: "Lieferbedingungen",
  TERMS_PAYMENT: "Zahlungsbedingungen",
};

export default async function TextTemplatesPage() {
  const org = await getActiveOrg();
  const templates = await dbInternal.textTemplate.findMany({
    where: { orgId: org.id },
    orderBy: [{ docType: "asc" }, { position: "asc" }, { name: "asc" }],
  });

  const byCombo = new Map<string, typeof templates>();
  for (const t of templates) {
    const key = `${t.docType}|${t.position}`;
    byCombo.set(key, [...(byCombo.get(key) ?? []), t]);
  }

  return (
    <div className="space-y-6">
      <SettingsTabs active="textvorlagen" />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dokumenttexte</h1>
        <Link href="/einstellungen/textvorlagen/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neue Vorlage
        </Link>
      </div>
      <p className="text-sm text-slate-500">
        Kopf-/Fußtext und Bedingungen, die beim Anlegen eines Belegs als Standard eingesetzt werden. Der Text wird als Snapshot am Beleg
        gespeichert — spätere Änderungen an der Vorlage wirken sich nur auf neue Belege aus.
      </p>

      {DOC_TYPES.map((docType) => {
        const positions = Object.keys(POSITION_LABEL).filter((p) => (byCombo.get(`${docType}|${p}`) ?? []).length > 0);
        if (positions.length === 0) return null;
        return (
          <section key={docType} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">{DOC_TYPE_LABEL[docType]}</h2>
            {positions.map((position) => {
              const items = byCombo.get(`${docType}|${position}`) ?? [];
              return (
                <div key={position} className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{POSITION_LABEL[position]}</h3>
                  <div className="divide-y divide-slate-100">
                    {items.map((t) => (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{t.name}</span>
                          {t.isDefault && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Standard</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <Link href={`/einstellungen/textvorlagen/${t.id}`} className="text-indigo-600 hover:underline">
                            Bearbeiten
                          </Link>
                          <TextTemplateRowActions id={t.id} isDefault={t.isDefault} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {templates.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Noch keine Dokumenttexte.{" "}
          <Link href="/einstellungen/textvorlagen/neu" className="font-medium text-indigo-600 hover:underline">
            Lege die erste Vorlage an.
          </Link>
        </div>
      )}
    </div>
  );
}
