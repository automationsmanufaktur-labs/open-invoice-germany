import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ensureCustomerNumbers } from "@/domain/numbering/ranges";
import { archiveCustomer } from "@/app/actions/masterdata";

export const dynamic = "force-dynamic";

export default async function KundenPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  try {
    const org = await getActiveOrg();
    // Selbstheilung (Phase 7, §34): Bestandskunden ohne Kundennummer bekommen beim ersten
    // Laden der Liste eine — idempotent, kein Effekt bei bereits vergebenen Nummern.
    await ensureCustomerNumbers(org.id);
  } catch {
    // Keine Organisation eingerichtet -> keine Kunden vorhanden, Liste bleibt leer.
  }

  const customers = await prisma.customer.findMany({
    where: {
      isArchived: false,
      ...(query ? { OR: [{ name: { contains: query } }, { customerNumber: { contains: query } }] } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, type: true, vatId: true, customerNumber: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Kunden</h1>
        <Link href="/kunden/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neuer Kunde
        </Link>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Suche nach Name oder Kundennummer…"
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none sm:w-80"
        />
        <button type="submit" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Suchen
        </button>
      </form>

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Noch keine Kunden. Lege deinen ersten Kunden an.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Nr.</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Ort</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">USt-IdNr.</th>
                <th className="px-4 py-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{c.customerNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/kunden/${c.id}`} className="font-medium text-indigo-600 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.city}</td>
                  <td className="px-4 py-3 text-slate-600">{c.type === "BUSINESS" ? "B2B" : "B2C"}</td>
                  <td className="px-4 py-3 text-slate-500">{c.vatId ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <form action={archiveCustomer} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <button className="text-xs text-slate-400 hover:text-rose-600">Archivieren</button>
                    </form>
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
