import { notFound, redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { draftFromInvoice, type InvoiceInitialLike } from "@/lib/editor/draft";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { loadDocumentSettings } from "@/domain/document/settings";
import { listAttachments } from "@/domain/attachment/manage";
import { loadPrintSettings, effectivePrintOptions } from "@/domain/settings/print";
import { printOptionsOverrideSchema } from "@/schemas";
import { listLayouts } from "@/lib/pdf/layouts/registry";

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

  const [customers, products, paymentMethods, contactRows, addressRows, attachments, documentSettings] = await Promise.all([
    dbInternal.customer.findMany({
      where: { orgId: org.id, isArchived: false },
      select: {
        id: true,
        name: true,
        customerNumber: true,
        email: true,
        defaultPaymentMethodId: true,
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
    listPaymentMethods(org.id),
    dbInternal.contactPerson.findMany({ where: { orgId: org.id }, orderBy: { lastName: "asc" } }),
    dbInternal.customerAddress.findMany({ where: { orgId: org.id }, orderBy: { label: "asc" } }),
    listAttachments(org.id, "INVOICE", inv.id),
    loadDocumentSettings(org.id),
  ]);

  const paymentMethodOptions = paymentMethods.filter((m) => m.isActive && m.code !== "SKONTO").map((m) => ({ id: m.id, name: m.name, paymentTermsDays: m.paymentTermsDays }));
  const contacts = contactRows.map((c) => ({ id: c.id, customerId: c.customerId, name: `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ""}`, isDefault: c.isDefault }));
  const addresses = addressRows.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    type: a.type as "BILLING" | "SHIPPING" | "OTHER",
    isDefault: a.isDefault,
    label: a.label ? `${a.label} — ${a.addressLine1}, ${a.postalCode} ${a.city}` : `${a.addressLine1}, ${a.postalCode} ${a.city}`,
  }));

  const invoiceInitial: InvoiceInitialLike = {
    id: inv.id,
    customerId: inv.customerId,
    taxScheme: inv.taxScheme,
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
    consumerRetentionHint: inv.consumerRetentionHint,
    paymentTerms: inv.paymentTerms ?? "",
    paymentMethodId: inv.paymentMethodId ?? "",
    headerText: inv.headerText ?? "",
    footerText: inv.footerText ?? "",
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

  const printSettings = await loadPrintSettings(org.id);
  const effectivePrint = effectivePrintOptions(printSettings, inv.printOptionsJson);
  let printOverride: ReturnType<typeof printOptionsOverrideSchema.parse> = {};
  try {
    printOverride = printOptionsOverrideSchema.parse(inv.printOptionsJson ? JSON.parse(inv.printOptionsJson) : {});
  } catch {
    printOverride = {};
  }

  return (
    <DocumentEditor
      mode="INVOICE"
      initial={draftFromInvoice(invoiceInitial, documentSettings.taxRates)}
      customers={customers}
      products={products}
      taxRates={documentSettings.taxRates}
      paymentMethods={paymentMethodOptions}
      contacts={contacts}
      addresses={addresses}
      layouts={listLayouts()}
      effectivePrintOptions={effectivePrint}
      printOverride={printOverride}
      attachments={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))}
      backHref={`/rechnungen/${id}`}
      title="Rechnungsentwurf bearbeiten"
    />
  );
}
