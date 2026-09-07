import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { NewDocumentForm, type DocumentInitial } from "@/components/NewDocumentForm";

export const dynamic = "force-dynamic";

export default async function BearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  const q = await dbInternal.quote.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!q) notFound();
  if (q.status !== "DRAFT") redirect(`/dokumente/${id}`);

  const [customers, products, contactRows, addressRows] = await Promise.all([
    dbInternal.customer.findMany({ where: { orgId: org.id, isArchived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    dbInternal.product.findMany({
      where: { orgId: org.id, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true },
      orderBy: { name: "asc" },
    }),
    dbInternal.contactPerson.findMany({ where: { orgId: org.id }, orderBy: { lastName: "asc" } }),
    dbInternal.customerAddress.findMany({ where: { orgId: org.id }, orderBy: { label: "asc" } }),
  ]);

  const contacts = contactRows.map((c) => ({ id: c.id, customerId: c.customerId, label: `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ""}` }));
  const addresses = addressRows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    label: a.label ? `${a.label} — ${a.addressLine1}, ${a.postalCode} ${a.city}` : `${a.addressLine1}, ${a.postalCode} ${a.city}`,
  }));

  const initial: DocumentInitial = {
    id: q.id,
    kind: q.kind,
    customerId: q.customerId,
    taxScheme: q.taxScheme,
    currency: q.currency,
    subject: q.subject ?? "",
    customerReference: q.customerReference ?? "",
    contactPersonId: q.contactPersonId ?? "",
    billingAddressId: q.billingAddressId ?? "",
    validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : "",
    headerText: q.headerText ?? "",
    footerText: q.footerText ?? "",
    deliveryTerms: q.deliveryTerms ?? "",
    paymentTerms: q.paymentTerms ?? "",
    notes: q.notes ?? "",
    internalNotes: q.internalNotes ?? "",
    documentDiscountPercent: (q.documentDiscountPermille / 10).toString(),
    documentDiscountAmount: (q.documentDiscountCents / 100).toFixed(2),
    documentChargePercent: (q.documentChargePermille / 10).toString(),
    documentChargeAmount: (q.documentChargeCents / 100).toFixed(2),
    documentChargeReason: q.documentChargeReason ?? "",
    lines: q.lines.map((l) => ({
      description: l.description,
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
        <Link href={`/dokumente/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Zurück
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Entwurf bearbeiten</h1>
      </div>
      <NewDocumentForm customers={customers} products={products} contacts={contacts} addresses={addresses} initial={initial} />
    </div>
  );
}
