import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { NewInvoiceForm, type InvoiceInitial } from "@/components/NewInvoiceForm";
import { listPaymentMethods } from "@/domain/payment-method/manage";

export const dynamic = "force-dynamic";

export default async function BearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  const inv = await dbInternal.invoice.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!inv) notFound();
  // Nur Entwuerfe sind bearbeitbar (GoBD, Lastenheft 51).
  if (inv.status !== "DRAFT") redirect(`/rechnungen/${id}`);

  const [customers, products, paymentMethods, contactRows, addressRows] = await Promise.all([
    dbInternal.customer.findMany({ where: { orgId: org.id, isArchived: false }, select: { id: true, name: true, defaultPaymentMethodId: true }, orderBy: { name: "asc" } }),
    dbInternal.product.findMany({
      where: { orgId: org.id, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true, articleNumber: true },
      orderBy: { name: "asc" },
    }),
    listPaymentMethods(org.id),
    dbInternal.contactPerson.findMany({ where: { orgId: org.id }, orderBy: { lastName: "asc" } }),
    dbInternal.customerAddress.findMany({ where: { orgId: org.id }, orderBy: { label: "asc" } }),
  ]);

  const paymentMethodOptions = paymentMethods.filter((m) => m.isActive && m.code !== "SKONTO").map((m) => ({ id: m.id, name: m.name, paymentTermsDays: m.paymentTermsDays }));
  const contacts = contactRows.map((c) => ({ id: c.id, customerId: c.customerId, label: `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ""}` }));
  const addresses = addressRows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    label: a.label ? `${a.label} — ${a.addressLine1}, ${a.postalCode} ${a.city}` : `${a.addressLine1}, ${a.postalCode} ${a.city}`,
  }));

  const initial: InvoiceInitial = {
    id: inv.id,
    customerId: inv.customerId,
    taxScheme: inv.taxScheme,
    currency: inv.currency,
    subject: inv.subject ?? "",
    orderNumber: inv.orderNumber ?? "",
    internalReference: inv.internalReference ?? "",
    buyerReference: inv.buyerReference ?? "",
    contactPersonId: inv.contactPersonId ?? "",
    billingAddressId: inv.billingAddressId ?? "",
    shippingAddressId: inv.shippingAddressId ?? "",
    deliveryStart: inv.deliveryStart ? inv.deliveryStart.toISOString().slice(0, 10) : "",
    deliveryEnd: inv.deliveryEnd ? inv.deliveryEnd.toISOString().slice(0, 10) : "",
    deliveryDate: inv.deliveryDate ? inv.deliveryDate.toISOString().slice(0, 10) : "",
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : "",
    notes: inv.notes ?? "",
    internalNotes: inv.internalNotes ?? "",
    paymentTerms: inv.paymentTerms ?? "",
    paymentMethodId: inv.paymentMethodId ?? "",
    documentDiscountPercent: (inv.documentDiscountPermille / 10).toString(),
    documentDiscountAmount: (inv.documentDiscountCents / 100).toFixed(2),
    documentChargePercent: (inv.documentChargePermille / 10).toString(),
    documentChargeAmount: (inv.documentChargeCents / 100).toFixed(2),
    documentChargeReason: inv.documentChargeReason ?? "",
    skonto1Percent: inv.skonto1Permille ? (inv.skonto1Permille / 10).toString() : "",
    skonto1Days: inv.skonto1Days ? inv.skonto1Days.toString() : "",
    skonto2Percent: inv.skonto2Permille ? (inv.skonto2Permille / 10).toString() : "",
    skonto2Days: inv.skonto2Days ? inv.skonto2Days.toString() : "",
    lines: inv.lines.map((l) => ({
      lineType: l.lineType as "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL",
      description: l.description,
      descriptionLong: l.descriptionLong ?? "",
      articleNumber: l.articleNumber ?? "",
      quantity: (l.quantityMilli / 1000).toString(),
      unit: l.unit,
      price: (l.unitNetPriceCents / 100).toFixed(2),
      taxRate: l.taxRate,
      discountPercent: (l.discountPermille / 10).toString(),
      discountAmount: (l.discountCents / 100).toFixed(2),
    })),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/rechnungen/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Zurück
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Rechnungsentwurf bearbeiten</h1>
      </div>
      <NewInvoiceForm customers={customers} products={products} paymentMethods={paymentMethodOptions} contacts={contacts} addresses={addresses} initial={initial} />
    </div>
  );
}
