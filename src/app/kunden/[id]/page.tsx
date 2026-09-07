import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { listPaymentMethods } from "@/domain/payment-method/manage";

export const dynamic = "force-dynamic";

export default async function KundeBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const customer = await prisma.customer.findFirst({ where: { id, orgId: org.id } });
  if (!customer) notFound();

  const paymentMethods = (await listPaymentMethods(org.id)).filter((m) => m.isActive || m.id === customer.defaultPaymentMethodId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/kunden" className="text-sm text-slate-500 hover:text-slate-800">
          ← Kunden
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Kunde bearbeiten</h1>
      </div>
      <CustomerForm customer={customer} paymentMethods={paymentMethods} />
    </div>
  );
}
