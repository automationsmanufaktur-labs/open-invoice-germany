import Link from "next/link";
import { prisma } from "@/lib/db";
import { intervalLabel } from "@/lib/recurring";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "aktiv", cls: "bg-emerald-100 text-emerald-800" },
  PAUSED: { text: "pausiert", cls: "bg-amber-100 text-amber-800" },
  ENDED: { text: "beendet", cls: "bg-slate-200 text-slate-600" },
};

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export default async function AbosPage() {
  const recs = await prisma.recurringInvoice.findMany({
    include: { customer: { select: { name: true } }, _count: { select: { invoices: true } } },
    orderBy: [{ status: "asc" }, { nextRunDate: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Abos / Wiederkehrende Rechnungen</h1>
        <Link href="/abos/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neues Abo
        </Link>
      </div>
      <p className="text-sm text-slate-500">
        Vorlagen, aus denen automatisch Rechnungen erzeugt werden — wöchentlich bis jährlich. Erzeugte Rechnungen durchlaufen Festschreibung,
        Nummernkreis und Audit wie jede andere Rechnung.
      </p>

      {recs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Noch keine Abos.{" "}
          <Link href="/abos/neu" className="font-medium text-indigo-600 hover:underline">
            Lege dein erstes Abo an.
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Bezeichnung</th>
                <th className="px-4 py-3">Kunde</th>
                <th className="px-4 py-3">Rhythmus</th>
                <th className="px-4 py-3">Nächste Rechnung</th>
                <th className="px-4 py-3 text-right">Erzeugt</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recs.map((r) => {
                const s = STATUS_LABEL[r.status] ?? { text: r.status, cls: "bg-slate-100 text-slate-600" };
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/abos/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.customer.name}</td>
                    <td className="px-4 py-3 text-slate-600">{intervalLabel(r.interval, r.intervalCount)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.status === "ENDED" ? "—" : deDate(r.nextRunDate)}</td>
                    <td className="tabular px-4 py-3 text-right text-slate-600">{r._count.invoices}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
