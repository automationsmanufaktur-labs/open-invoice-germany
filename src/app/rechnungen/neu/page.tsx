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

  const [customers, products, paymentMethods, contactRows, addressRows] = await Promise.all([
    prisma.customer.findMany({
      where: { orgId, isArchived: false },
      select: { id: true, name: true, defaultPaymentMethodId: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { orgId, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true, articleNumber: true },
      orderBy: { name: "asc" },
    }),
    listPaymentMethods(orgId),
    prisma.contactPerson.findMany({ where: { orgId }, orderBy: { lastName: "asc" } }),
    prisma.customerAddress.findMany({ where: { orgId }, orderBy: { label: "asc" } }),
  ]);
  const contacts = contactRows.map((c) => ({ id: c.id, customerId: c.customerId, label: `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ""}` }));
  const addresses = addressRows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    label: a.label ? `${a.label} — ${a.addressLine1}, ${a.postalCode} ${a.city}` : `${a.addressLine1}, ${a.postalCode} ${a.city}`,
  }));
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
      <NewInvoiceForm customers={customers} products={products} paymentMethods={paymentMethodOptions} contacts={contacts} addresses={addresses} />
    </div>
  );
}
