import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { formatCents, formatQuantity } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentActions } from "@/components/DocumentActions";
import { ConvertMenu } from "@/components/ConvertMenu";
import { DocumentChain } from "@/components/DocumentChain";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { listAttachments } from "@/domain/attachment/manage";
import { PrintOptionsPanel } from "@/components/PrintOptionsPanel";
import { loadPrintSettings, effectivePrintOptions } from "@/domain/settings/print";
import { printOptionsOverrideSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// B11 (Fix-Welle): Client-seitige Kopie von DELIVERY_NOTE_STATUS_ALLOWED
// (src/domain/invoice/partial.ts, dort nicht importierbar wegen dbInternal) — steuert
// nur, ob der ConvertMenu-Einstieg angeboten wird, die eigentliche Pruefung bleibt
// serverseitig (409 bei Regelverstoss).
const DELIVERY_NOTE_PARTIAL_INVOICE_STATUSES = new Set(["CREATED", "SENT", "DELIVERED"]);

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export default async function LieferscheinDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const dn = await dbInternal.deliveryNote.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } }, customer: true },
  });
  if (!dn) notFound();

  const archived = dn.archivedAt !== null;
  const attachments = await listAttachments(org.id, "DELIVERY_NOTE", dn.id);
  const printSettings = await loadPrintSettings(org.id);
  const effectivePrint = effectivePrintOptions(printSettings, dn.printOptionsJson);
  let printOverride: ReturnType<typeof printOptionsOverrideSchema.parse> = {};
  try {
    printOverride = printOptionsOverrideSchema.parse(dn.printOptionsJson ? JSON.parse(dn.printOptionsJson) : {});
  } catch {
    printOverride = {};
  }
  // B11 (Fix-Welle): Teilrechnung-Einstieg nur in einem abrechenbaren Status; Anteils-
  // Modi (PERCENT/NET_AMOUNT/GROSS_AMOUNT) nur, wenn ALLE Positionen einen Preis tragen
  // (preisloser Lieferschein ist der Normalfall, `showPrices` defaultet auf false).
  const canBillDeliveryNote = DELIVERY_NOTE_PARTIAL_INVOICE_STATUSES.has(dn.status);
  const allowShareModes = dn.lines.length > 0 && dn.lines.every((l) => l.unitNetPriceCents != null);

  let sourceLabel: { href: string; text: string } | null = null;
  if (dn.sourceType === "QUOTE" && dn.sourceId) {
    const src = await dbInternal.quote.findFirst({ where: { id: dn.sourceId, orgId: org.id }, select: { number: true } });
    if (src) sourceLabel = { href: `/dokumente/${dn.sourceId}`, text: src.number ?? "Quelldokument" };
  } else if (dn.sourceType === "INVOICE" && dn.sourceId) {
    const src = await dbInternal.invoice.findFirst({ where: { id: dn.sourceId, orgId: org.id }, select: { number: true } });
    if (src) sourceLabel = { href: `/rechnungen/${dn.sourceId}`, text: src.number ?? "Quellrechnung" };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/lieferscheine" className="text-sm text-slate-500 hover:text-slate-800">
            ← Lieferscheine
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Lieferschein {dn.number ?? "(Entwurf)"}</h1>
          <StatusBadge status={dn.status} />
          {archived && <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Archiviert</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dn.number && (
            <a
              href={`/api/delivery-notes/${dn.id}/pdf`}
              target="_blank"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              PDF
            </a>
          )}
          {dn.status !== "DRAFT" && <SendEmailDialog docType="DELIVERY_NOTE" docId={dn.id} />}
          {/* B11 (Fix-Welle): Teilrechnung aus Lieferschein — Backend/MCP existierten
              bereits, der UI-Einstieg fehlte. Share-Modi nur, wenn alle Positionen einen
              Preis tragen. */}
          <ConvertMenu
            sourceType="DELIVERY_NOTE"
            sourceId={dn.id}
            showToDeliveryNote={false}
            showPartialInvoice={canBillDeliveryNote}
            allowShareModesInPartialInvoice={allowShareModes}
          />
        </div>
      </div>

      <DocumentActions type="DELIVERY_NOTE" id={dn.id} status={dn.status} archived={archived} />

      {dn.status === "DRAFT" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Entwurf — noch keine Nummer. Erst mit „Lieferschein erstellen&rdquo; wird eine Belegnummer vergeben.
        </div>
      )}

      {sourceLabel && (
        <p className="text-sm text-slate-600">
          Bezugsbeleg:{" "}
          <Link href={sourceLabel.href} className="font-medium text-indigo-600 hover:underline">
            {sourceLabel.text}
          </Link>
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Empfänger</h2>
        <p className="text-slate-700">{dn.customer.name}</p>
        <p className="text-slate-600">{dn.customer.addressLine1}</p>
        <p className="text-slate-600">
          {dn.customer.postalCode} {dn.customer.city}
        </p>
      </div>

      {dn.headerText && <p className="whitespace-pre-line text-sm text-slate-700">{dn.headerText}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {dn.showArticleNumber && <th className="px-4 py-2">Art.-Nr.</th>}
              {dn.showDescription && <th className="px-4 py-2">Beschreibung</th>}
              <th className="px-4 py-2 text-right">Menge</th>
              {dn.showPrices && <th className="px-4 py-2 text-right">Einzel</th>}
              {dn.showPrices && dn.showTax && <th className="px-4 py-2 text-right">USt</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dn.lines.map((l) => (
              <tr key={l.id}>
                {dn.showArticleNumber && <td className="px-4 py-2 text-slate-500">{l.articleNumber ?? ""}</td>}
                {dn.showDescription && <td className="px-4 py-2 text-slate-700">{l.description}</td>}
                <td className="tabular px-4 py-2 text-right">
                  {formatQuantity(l.quantityMilli)} {l.unit}
                </td>
                {dn.showPrices && <td className="tabular px-4 py-2 text-right">{l.unitNetPriceCents != null ? formatCents(l.unitNetPriceCents) : ""}</td>}
                {dn.showPrices && dn.showTax && <td className="tabular px-4 py-2 text-right">{l.taxRate != null ? `${l.taxRate}%` : ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dn.footerText && <p className="whitespace-pre-line text-sm text-slate-700">{dn.footerText}</p>}
      {dn.notes && <p className="text-sm text-slate-600">{dn.notes}</p>}

      {dn.internalNotes && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="mr-2 font-medium">Interne Notiz</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">nur intern sichtbar</span>
          <p className="mt-1 whitespace-pre-line">{dn.internalNotes}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-y-1 text-sm text-slate-600 sm:max-w-xs">
        <dt>Ausstellungsdatum</dt>
        <dd className="text-right">{deDate(dn.issueDate)}</dd>
        <dt>Lieferdatum</dt>
        <dd className="text-right">{deDate(dn.deliveryDate)}</dd>
        {dn.shippingDate && (
          <>
            <dt>Versanddatum</dt>
            <dd className="text-right">{deDate(dn.shippingDate)}</dd>
          </>
        )}
      </div>

      <AttachmentPanel docType="DELIVERY_NOTE" docId={dn.id} initial={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))} />

      {dn.status === "DRAFT" && <PrintOptionsPanel docId={dn.id} apiKind="delivery-notes" effective={effectivePrint} initialOverride={printOverride} />}

      <DocumentChain orgId={org.id} type="DELIVERY_NOTE" id={dn.id} />

      <EmailHistory docType="DELIVERY_NOTE" docId={dn.id} />
    </div>
  );
}
