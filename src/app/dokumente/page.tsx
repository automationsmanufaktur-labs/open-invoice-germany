import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { listQuotes } from "@/domain/document/list";
import { availableActions } from "@/domain/document/actions";
import { formatCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { FilterBar, type FilterField } from "@/components/list/FilterBar";
import { Pagination } from "@/components/list/Pagination";
import { RowActionsMenu } from "@/components/list/RowActionsMenu";
import { loadListPage } from "@/lib/list-page";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma",
};

type SP = Record<string, string | string[] | undefined>;

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DokumentePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const showArchived = firstOf(sp.archiviert) === "1";
  const values: Record<string, string | undefined> = {
    q: firstOf(sp.q),
    status: firstOf(sp.status),
    kind: firstOf(sp.kind),
    from: firstOf(sp.from),
    to: firstOf(sp.to),
    archiviert: firstOf(sp.archiviert),
  };

  const org = await getActiveOrg();
  // Fix-Welle (B1): siehe rechnungen/page.tsx.
  const result = await loadListPage(sp, (f) => listQuotes(org.id, f), { extra: { includeArchived: showArchived } });
  const rows = result.rows;

  const fields: FilterField[] = [
    { type: "text", name: "q", label: "Suche", placeholder: "Nummer, Kunde…" },
    {
      type: "select",
      name: "status",
      label: "Status",
      options: ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].map((v) => ({ value: v, label: v })),
    },
    {
      type: "select",
      name: "kind",
      label: "Art",
      options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
    },
    { type: "date", name: "from", label: "Von" },
    { type: "date", name: "to", label: "Bis" },
  ];

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

      <FilterBar basePath="/dokumente" fields={fields} values={values} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Keine Dokumente gefunden.{" "}
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
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => {
                const actions = availableActions({
                  kind: "QUOTE",
                  type: d.kind,
                  status: d.effectiveStatus,
                  isDraft: d.effectiveStatus === "DRAFT",
                  hasEmailLog: d.hasEmailLog,
                });
                return (
                  <tr key={d.id} className={`hover:bg-slate-50 ${d.archivedAt ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/dokumente/${d.id}`} className="font-medium text-indigo-600 hover:underline">
                        {d.number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{KIND_LABEL[d.kind] ?? d.kind}</td>
                    <td className="px-4 py-3 text-slate-600">{d.customerName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.effectiveStatus} />
                      {d.archivedAt && <span className="ml-2 text-xs text-slate-400">archiviert</span>}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">{formatCents(d.grossTotalCents, d.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <RowActionsMenu
                        kind="QUOTE"
                        id={d.id}
                        actions={actions}
                        openHref={`/dokumente/${d.id}`}
                        editHref={d.effectiveStatus === "DRAFT" ? `/dokumente/${d.id}/bearbeiten` : undefined}
                        pdfHref={`/api/documents/${d.id}/pdf`}
                        emailDocType={d.kind as "ANGEBOT" | "AUFTRAGSBESTAETIGUNG" | "PROFORMA"}
                        hasEmailLog={d.hasEmailLog}
                        duplicateRoute={`/api/documents/${d.id}/duplicate`}
                        duplicateRedirect="/dokumente/{id}"
                        cancelRoute={`/api/documents/${d.id}/status`}
                        cancelBody={{ action: "CANCEL" }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination basePath="/dokumente" searchParams={values} total={result.total} limit={result.limit} offset={result.offset} />
        </div>
      )}
    </div>
  );
}
