import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PaymentMethodForm } from "@/components/forms/PaymentMethodForm";

export const dynamic = "force-dynamic";

export default async function PaymentMethodEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  const method = id === "neu" ? null : await dbInternal.paymentMethod.findFirst({ where: { id, orgId: org.id } });
  if (id !== "neu" && !method) notFound();

  return (
    <div className="space-y-6">
      <SettingsTabs active="zahlungsmethoden" />
      <div className="flex items-center gap-3">
        <Link href="/einstellungen/zahlungsmethoden" className="text-sm text-slate-500 hover:text-slate-800">
          ← Zahlungsmethoden
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{method ? "Zahlungsmethode bearbeiten" : "Neue Zahlungsmethode"}</h1>
      </div>

      <PaymentMethodForm method={method} />
    </div>
  );
}
