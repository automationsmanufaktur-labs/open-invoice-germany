import Link from "next/link";
import { dbInternal } from "@/lib/db";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { NeedOrgNotice } from "@/components/NeedOrgNotice";
import { listPaymentMethods } from "@/domain/payment-method/manage";

export const dynamic = "force-dynamic";

export default async function NeuerKundePage() {
  const org = await dbInternal.organization.findFirst({ select: { id: true } });
  if (!org) return <NeedOrgNotice />;

  const paymentMethods = (await listPaymentMethods(org.id)).filter((m) => m.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/kunden" className="text-sm text-slate-500 hover:text-slate-800">
          ← Kunden
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Neuer Kunde</h1>
      </div>
      <CustomerForm paymentMethods={paymentMethods} />
    </div>
  );
}
