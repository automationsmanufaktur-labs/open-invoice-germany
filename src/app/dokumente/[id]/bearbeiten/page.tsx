import { notFound, redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { draftFromDocument, type DocumentInitialLike } from "@/lib/editor/draft";
import { loadDocumentSettings } from "@/domain/document/settings";
import { listAttachments } from "@/domain/attachment/manage";
import { loadPrintSettings, effectivePrintOptions } from "@/domain/settings/print";
import { printOptionsOverrideSchema } from "@/schemas";
import { listLayouts } from "@/lib/pdf/layouts/registry";

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

  const [customers, products, contactRows, addressRows, attachments, documentSettings] = await Promise.all([
    dbInternal.customer.findMany({
      where: { orgId: org.id, isArchived: false },
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
      where: { orgId: org.id, isArchived: false },
      select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true, articleNumber: true },
      orderBy: { name: "asc" },
    }),
    dbInternal.contactPerson.findMany({ where: { orgId: org.id }, orderBy: { lastName: "asc" } }),
    dbInternal.customerAddress.findMany({ where: { orgId: org.id }, orderBy: { label: "asc" } }),
    listAttachments(org.id, "QUOTE", q.id),
    loadDocumentSettings(org.id),
  ]);

  const contacts = contactRows.map((c) => ({ id: c.id, customerId: c.customerId, name: `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ""}`, isDefault: c.isDefault }));
  const addresses = addressRows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    type: a.type as "BILLING" | "SHIPPING" | "OTHER",
    isDefault: a.isDefault,
    label: a.label ? `${a.label} — ${a.addressLine1}, ${a.postalCode} ${a.city}` : `${a.addressLine1}, ${a.postalCode} ${a.city}`,
  }));

  const documentInitial: DocumentInitialLike = {
    id: q.id,
    kind: q.kind,
    customerId: q.customerId,
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

  const printSettings = await loadPrintSettings(org.id);
  const effectivePrint = effectivePrintOptions(printSettings, q.printOptionsJson);
  let printOverride: ReturnType<typeof printOptionsOverrideSchema.parse> = {};
  try {
    printOverride = printOptionsOverrideSchema.parse(q.printOptionsJson ? JSON.parse(q.printOptionsJson) : {});
  } catch {
    printOverride = {};
  }

  return (
    <DocumentEditor
      mode="DOCUMENT"
      initial={draftFromDocument(documentInitial, documentSettings.taxRates)}
      customers={customers}
      products={products}
      taxRates={documentSettings.taxRates}
      contacts={contacts}
      addresses={addresses}
      layouts={listLayouts()}
      effectivePrintOptions={effectivePrint}
      printOverride={printOverride}
      attachments={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))}
      backHref={`/dokumente/${id}`}
      title="Entwurf bearbeiten"
    />
  );
}
