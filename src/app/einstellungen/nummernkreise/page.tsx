import { getActiveOrg } from "@/lib/org";
import { listNumberRanges } from "@/domain/numbering/ranges";
import { SettingsTabs } from "@/components/SettingsTabs";
import { NumberRangesEditor } from "@/components/settings/NumberRangesEditor";

export const dynamic = "force-dynamic";

export default async function NumberRangesPage() {
  const org = await getActiveOrg();
  const year = new Date().getFullYear();
  const ranges = await listNumberRanges(org.id, year);

  return (
    <div className="space-y-6">
      <SettingsTabs active="nummernkreise" />
      <h1 className="text-2xl font-bold tracking-tight">Nummernkreise</h1>
      <p className="text-sm text-slate-600">
        Präfix, Muster und nächste Nummer je Belegtyp sowie Kunden-/Artikelnummern ({year}). Nummern können nie zurückgedreht werden (§14 Abs. 4 Nr. 4 UStG).
      </p>
      <NumberRangesEditor initialRanges={ranges} />
    </div>
  );
}
