import Link from "next/link";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { NeedOrgNotice } from "@/components/NeedOrgNotice";
import { loadDocumentSettings } from "@/domain/document/settings";
import { listLayouts } from "@/lib/pdf/layouts/registry";

export const dynamic = "force-dynamic";

export default async function NeuesDokumentPage() {
  let orgId: string;
  try {
    orgId = (await getActiveOrg()).id;
  } catch {
    return <NeedOrgNotice />;
  }

  const [customers, products, contactRows, addressRows] = await Promise.all([
    dbInternal.customer.findMany({
      where: { orgId, isArchived: false },
      select: {
        id: true,
        name: true,
        customerNumber: true,
        email: true,
        defaultDiscountPermille: true,
        addressLine1: true,
        postalCode: true,
        city: true,
        countryCode: true,
      },
      orderBy: { name: "asc" },
    }),
    dbInternal.product.findMany({
      where: { orgId, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true, articleNumber: true },
      orderBy: { name: "asc" },
    }),
    dbInternal.contactPerson.findMany({ where: { orgId }, orderBy: { lastName: "asc" } }),
    dbInternal.customerAddress.findMany({ where: { orgId }, orderBy: { label: "asc" } }),
  ]);
  const documentSettings = await loadDocumentSettings(orgId);

  const contacts = contactRows.map((c) => ({
    id: c.id,
    customerId: c.customerId,
    name: `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ""}`,
    isDefault: c.isDefault,
  }));
  const addresses = addressRows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    type: a.type as "BILLING" | "SHIPPING" | "OTHER",
    isDefault: a.isDefault,
    label: a.label ? `${a.label} — ${a.addressLine1}, ${a.postalCode} ${a.city}` : `${a.addressLine1}, ${a.postalCode} ${a.city}`,
  }));

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
    <DocumentEditor
      mode="DOCUMENT"
      customers={customers}
      products={products}
      taxRates={documentSettings.taxRates}
      contacts={contacts}
      addresses={addresses}
      layouts={listLayouts()}
      offerLastDocument={documentSettings.offerLastDocument}
      backHref="/dokumente"
      title="Neues Dokument"
    />
  );
}
