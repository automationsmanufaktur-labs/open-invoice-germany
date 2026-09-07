import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { PaymentMethodRowActions } from "@/components/forms/PaymentMethodRowActions";

export const dynamic = "force-dynamic";

export default async function PaymentMethodsPage() {
  const org = await getActiveOrg();
  const methods = await listPaymentMethods(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="zahlungsmethoden" />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Zahlungsmethoden</h1>
        <Link href="/einstellungen/zahlungsmethoden/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neue Zahlungsmethode
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Zahlungsziel</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {methods.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{m.code}</td>
                <td className="px-4 py-2 text-slate-800">
                  <Link href={`/einstellungen/zahlungsmethoden/${m.id}`} className="font-medium text-indigo-600 hover:underline">
                    {m.name}
                  </Link>
                  {m.isSystem && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">System</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{m.paymentTermsDays != null ? `${m.paymentTermsDays} Tage` : "—"}</td>
                <td className="px-4 py-2">
                  {m.isActive ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Aktiv</span>
                  ) : (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Inaktiv</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <PaymentMethodRowActions id={m.id} isSystem={m.isSystem} />
                </td>
              </tr>
            ))}
            {methods.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Noch keine Zahlungsmethoden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
