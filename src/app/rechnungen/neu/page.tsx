import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { NewInvoiceForm } from "@/components/NewInvoiceForm";
import { NeedOrgNotice } from "@/components/NeedOrgNotice";
import { listPaymentMethods } from "@/domain/payment-method/manage";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  let orgId: string;
  try {
    const org = await getActiveOrg();
    orgId = org.id;
  } catch {
    return <NeedOrgNotice />;
  }

  const [customers, products, paymentMethods] = await Promise.all([
    prisma.customer.findMany({
      where: { orgId, isArchived: false },
      select: { id: true, name: true, defaultPaymentMethodId: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { orgId, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true },
      orderBy: { name: "asc" },
    }),
    listPaymentMethods(orgId),
  ]);
  // SKONTO ist ein reiner Systemcode fuer die automatische Skontobuchung
  // (detectSkonto) — im Rechnungs-Editor nie manuell waehlbar.
  const paymentMethodOptions = paymentMethods
    .filter((m) => m.isActive && m.code !== "SKONTO")
    .map((m) => ({ id: m.id, name: m.name, paymentTermsDays: m.paymentTermsDays }));

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
        <Link href="/rechnungen" className="text-sm text-slate-500 hover:text-slate-800">
          ← Rechnungen
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Neue Rechnung</h1>
      </div>
      <NewInvoiceForm customers={customers} products={products} paymentMethods={paymentMethodOptions} />
    </div>
  );
}
