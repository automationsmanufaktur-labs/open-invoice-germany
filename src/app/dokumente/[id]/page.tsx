import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents, formatQuantity } from "@/lib/money";
import { ConvertButton } from "@/components/ConvertButton";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import type { EmailDocType } from "@/schemas/email";

export const dynamic = "force-dynamic";

const KIND_TITLE: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma-Rechnung",
};

export default async function DokumentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, customer: true },
  });
  if (!q) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dokumente" className="text-sm text-slate-500 hover:text-slate-800">
            ← Dokumente
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {KIND_TITLE[q.kind] ?? "Dokument"} {q.number}
          </h1>
          {q.snapshotSource === "MIGRATION" && (
            <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Adressstand per Migration eingefroren
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/documents/${q.id}/pdf`}
            target="_blank"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF
          </a>
          <SendEmailDialog docType={q.kind as EmailDocType} docId={q.id} />
          {q.convertedToInvoiceId ? (
            <Link href={`/rechnungen/${q.convertedToInvoiceId}`} className="text-sm font-medium text-indigo-600 hover:underline">
              → zur Rechnung
            </Link>
          ) : (
            <ConvertButton documentId={q.id} />
          )}
        </div>
      </div>

      {q.kind === "PROFORMA" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Proforma-Rechnung — keine Rechnung im Sinne des § 14 UStG, berechtigt nicht zum Vorsteuerabzug.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Empfänger</h2>
        <p className="text-slate-700">{q.customer.name}</p>
        <p className="text-slate-600">{q.customer.addressLine1}</p>
        <p className="text-slate-600">
          {q.customer.postalCode} {q.customer.city}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Beschreibung</th>
              <th className="px-4 py-2 text-right">Menge</th>
              <th className="px-4 py-2 text-right">Einzel</th>
              <th className="px-4 py-2 text-right">USt</th>
              <th className="px-4 py-2 text-right">Netto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 text-slate-700">{l.description}</td>
                <td className="tabular px-4 py-2 text-right">
                  {formatQuantity(l.quantityMilli)} {l.unit}
                </td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.unitNetPriceCents, q.currency)}</td>
                <td className="tabular px-4 py-2 text-right">{l.taxRate}%</td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.lineNetCents, q.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Netto</span>
          <span className="tabular font-medium">{formatCents(q.netTotalCents, q.currency)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>zzgl. USt</span>
          <span className="tabular">{formatCents(q.taxTotalCents, q.currency)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
          <span>Gesamt</span>
          <span className="tabular">{formatCents(q.grossTotalCents, q.currency)}</span>
        </div>
      </div>

      {q.notes && <p className="text-sm text-slate-600">{q.notes}</p>}

      {q.internalNotes && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="mr-2 font-medium">Interne Notiz</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">nur intern sichtbar</span>
          <p className="mt-1 whitespace-pre-line">{q.internalNotes}</p>
        </div>
      )}

      <EmailHistory docType={q.kind as EmailDocType} docId={q.id} />
    </div>
  );
}
