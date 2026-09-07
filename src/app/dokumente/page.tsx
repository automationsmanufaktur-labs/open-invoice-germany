import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { effectiveQuoteStatus } from "@/domain/document/status";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma",
};

export default async function DokumentePage({ searchParams }: { searchParams: Promise<{ archiviert?: string }> }) {
  const { archiviert } = await searchParams;
  const showArchived = archiviert === "1";
  const org = await getActiveOrg();

  const docs = await dbInternal.quote.findMany({
    where: { orgId: org.id, ...(showArchived ? {} : { archivedAt: null }) },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dokumente</h1>
        <Link href="/dokumente/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neues Dokument
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Angebote, Auftragsbestätigungen und Proforma-Rechnungen — keine Steuerbelege; jederzeit in eine Rechnung umwandelbar.</p>
        <Link href={showArchived ? "/dokumente" : "/dokumente?archiviert=1"} className="text-sm font-medium text-indigo-600 hover:underline">
          {showArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
        </Link>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Noch keine Dokumente.{" "}
          <Link href="/dokumente/neu" className="font-medium text-indigo-600 hover:underline">
            Lege dein erstes Angebot an.
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3">Art</th>
                <th className="px-4 py-3">Kunde</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Brutto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((d) => (
                <tr key={d.id} className={`hover:bg-slate-50 ${d.archivedAt ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3">
                    <Link href={`/dokumente/${d.id}`} className="font-medium text-indigo-600 hover:underline">
                      {d.number ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{KIND_LABEL[d.kind] ?? d.kind}</td>
                  <td className="px-4 py-3 text-slate-600">{d.customer.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={effectiveQuoteStatus({ status: d.status, validUntil: d.validUntil })} />
                    {d.archivedAt && <span className="ml-2 text-xs text-slate-400">archiviert</span>}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-medium">{formatCents(d.grossTotalCents, d.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
