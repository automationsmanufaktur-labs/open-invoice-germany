import Link from "next/link";
import { notFound } from "next/navigation";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { loadDocumentSettings } from "@/domain/document/settings";
import { NewRecurringForm, type RecurringInitialValues } from "@/components/NewRecurringForm";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** Fix-Runde 1 (Koordinator, Abo-Bearbeiten-UI): `/abos/[id]/bearbeiten` — reine
 *  Kopf-/Positionsaenderung eines bestehenden Abos, kein Kundenwechsel (siehe
 *  NewRecurringForm mode="edit" und updateRecurringSchema). */
export default async function AboBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();

  const rec = await dbInternal.recurringInvoice.findFirst({
    where: { id, orgId: org.id },
    include: { customer: { select: { name: true } }, lines: { orderBy: { position: "asc" } } },
  });
  if (!rec) notFound();

  const docSettings = await loadDocumentSettings(org.id);
  const products = await dbInternal.product.findMany({
    where: { orgId: org.id, isArchived: false },
    select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true },
    orderBy: { name: "asc" },
  });
  const emailTemplates = await dbInternal.emailTemplate.findMany({
    where: { orgId: org.id, docType: "INVOICE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const initial: RecurringInitialValues = {
    title: rec.title,
    interval: rec.interval,
    intervalCount: rec.intervalCount,
    startDate: toDateInput(rec.startDate),
    endDate: toDateInput(rec.endDate),
    maxRuns: rec.maxRuns != null ? String(rec.maxRuns) : "",
    paymentTermsDays: rec.paymentTermsDays,
    autoFinalize: rec.autoFinalize,
    autoSend: rec.autoSend,
    emailTemplateId: rec.emailTemplateId ?? "",
    showPeriodText: rec.showPeriodText,
    notes: rec.notes ?? "",
    taxScheme: rec.taxScheme,
    currency: rec.currency,
    lines: rec.lines.map((l) => ({
      description: l.description,
      quantity: (l.quantityMilli / 1000).toString(),
      unit: l.unit,
      price: (l.unitNetPriceCents / 100).toFixed(2),
      taxRate: l.taxRate,
    })),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/abos/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← {rec.title}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Abo bearbeiten</h1>
      </div>
      <NewRecurringForm
        mode="edit"
        recurringId={id}
        customerName={rec.customer.name}
        customers={[]}
        products={products}
        emailTemplates={emailTemplates}
        defaultAutoFinalize={docSettings.recurringAutoFinalizeDefault}
        defaultAutoSend={docSettings.recurringAutoSendDefault}
        defaultShowPeriodText={docSettings.recurringInsertPeriodText}
        initial={initial}
      />
    </div>
  );
}
