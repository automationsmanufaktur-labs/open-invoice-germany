import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export default async function LieferscheinePage({ searchParams }: { searchParams: Promise<{ archiviert?: string }> }) {
  const { archiviert } = await searchParams;
  const showArchived = archiviert === "1";
  const org = await getActiveOrg();

  const notes = await dbInternal.deliveryNote.findMany({
    where: { orgId: org.id, ...(showArchived ? {} : { archivedAt: null }) },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

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

      {notes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Noch keine Lieferscheine.{" "}
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
                <th className="px-4 py-3">Lieferdatum</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {notes.map((n) => (
                <tr key={n.id} className={`hover:bg-slate-50 ${n.archivedAt ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3">
                    <Link href={`/lieferscheine/${n.id}`} className="font-medium text-indigo-600 hover:underline">
                      {n.number ?? "(Entwurf)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{n.customer.name}</td>
                  <td className="px-4 py-3 text-slate-600">{deDate(n.deliveryDate)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={n.status} />
                    {n.archivedAt && <span className="ml-2 text-xs text-slate-400">archiviert</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
