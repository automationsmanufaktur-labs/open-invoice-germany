import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { listDeliveryNotes } from "@/domain/document/list";
import { availableActions } from "@/domain/document/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { FilterBar, type FilterField } from "@/components/list/FilterBar";
import { Pagination } from "@/components/list/Pagination";
import { RowActionsMenu } from "@/components/list/RowActionsMenu";
import { loadListPage } from "@/lib/list-page";

export const dynamic = "force-dynamic";

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

type SP = Record<string, string | string[] | undefined>;

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LieferscheinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const showArchived = firstOf(sp.archiviert) === "1";
  const values: Record<string, string | undefined> = {
    q: firstOf(sp.q),
    status: firstOf(sp.status),
    from: firstOf(sp.from),
    to: firstOf(sp.to),
    archiviert: firstOf(sp.archiviert),
  };

  const org = await getActiveOrg();
  // Fix-Welle (B1): siehe rechnungen/page.tsx.
  const result = await loadListPage(sp, (f) => listDeliveryNotes(org.id, f), { extra: { includeArchived: showArchived } });

  const fields: FilterField[] = [
    { type: "text", name: "q", label: "Suche", placeholder: "Nummer, Kunde…" },
    {
      type: "select",
      name: "status",
      label: "Status",
      options: ["DRAFT", "CREATED", "SENT", "DELIVERED", "CANCELLED"].map((v) => ({ value: v, label: v })),
    },
    { type: "date", name: "from", label: "Von" },
    { type: "date", name: "to", label: "Bis" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Lieferscheine</h1>
        <Link href="/lieferscheine/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neuer Lieferschein
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Kein Steuerbeleg — Nachweis des Leistungszeitpunkts.</p>
        <Link href={showArchived ? "/lieferscheine" : "/lieferscheine?archiviert=1"} className="text-sm font-medium text-indigo-600 hover:underline">
          {showArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
        </Link>
      </div>

      <FilterBar basePath="/lieferscheine" fields={fields} values={values} />

      {result.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Keine Lieferscheine gefunden.{" "}
          <Link href="/lieferscheine/neu" className="font-medium text-indigo-600 hover:underline">
            Lege den ersten Lieferschein an.
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3">Kunde</th>
                <th className="px-4 py-3">Belegdatum</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.rows.map((n) => {
                const actions = availableActions({
                  kind: "DELIVERY_NOTE",
                  type: "DELIVERY_NOTE",
                  status: n.status,
                  isDraft: n.status === "DRAFT",
                  hasEmailLog: n.hasEmailLog,
                });
                return (
                  <tr key={n.id} className={`hover:bg-slate-50 ${n.archivedAt ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/lieferscheine/${n.id}`} className="font-medium text-indigo-600 hover:underline">
                        {n.number ?? "(Entwurf)"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{n.customerName}</td>
                    <td className="px-4 py-3 text-slate-600">{deDate(n.issueDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={n.status} />
                      {n.archivedAt && <span className="ml-2 text-xs text-slate-400">archiviert</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowActionsMenu
                        kind="DELIVERY_NOTE"
                        id={n.id}
                        actions={actions}
                        openHref={`/lieferscheine/${n.id}`}
                        // Keine Bearbeiten-Seite fuer Lieferscheine (vorbestehende Luecke,
                        // nicht Teil dieses Tasks) — EDIT wird trotz ActionKey nicht gerendert.
                        pdfHref={`/api/delivery-notes/${n.id}/pdf`}
                        emailDocType="DELIVERY_NOTE"
                        hasEmailLog={n.hasEmailLog}
                        duplicateRoute={`/api/delivery-notes/${n.id}/duplicate`}
                        duplicateRedirect="/lieferscheine/{id}"
                        cancelRoute={`/api/delivery-notes/${n.id}/status`}
                        cancelBody={{ action: "CANCEL" }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination basePath="/lieferscheine" searchParams={values} total={result.total} limit={result.limit} offset={result.offset} />
        </div>
      )}
    </div>
  );
}
