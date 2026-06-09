import Link from "next/link";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { NewRecurringForm } from "@/components/NewRecurringForm";
import { NeedOrgNotice } from "@/components/NeedOrgNotice";

export const dynamic = "force-dynamic";

export default async function NeuesAboPage() {
  let orgId: string;
  try {
    orgId = (await getActiveOrg()).id;
  } catch {
    return <NeedOrgNotice />;
  }

  const [customers, products] = await Promise.all([
    dbInternal.customer.findMany({ where: { orgId, isArchived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    dbInternal.product.findMany({
      where: { orgId, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (customers.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Noch keine Kunden angelegt. Lege zuerst einen{" "}
        <Link href="/kunden/neu" className="font-medium underline">
          Kunden an
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/abos" className="text-sm text-slate-500 hover:text-slate-800">
          ← Abos
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Neues Abo</h1>
      </div>
      <NewRecurringForm customers={customers} products={products} />
    </div>
  );
}
