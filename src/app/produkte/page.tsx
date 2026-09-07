import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ensureArticleNumbers } from "@/domain/numbering/ranges";
import { formatCents } from "@/lib/money";
import { archiveProduct } from "@/app/actions/masterdata";

export const dynamic = "force-dynamic";

export default async function ProduktePage() {
  try {
    const org = await getActiveOrg();
    // Selbstheilung (Nit, Final-Review, analog Kundenliste): Bestandsprodukte ohne
    // Artikelnummer bekommen beim ersten Laden der Liste eine — idempotent.
    await ensureArticleNumbers(org.id);
  } catch {
    // Keine Organisation eingerichtet -> keine Produkte vorhanden, Liste bleibt leer.
  }

  const products = await prisma.product.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, unit: true, netPriceCents: true, taxRate: true, differential: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Produkte & Leistungen</h1>
        <Link href="/produkte/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neues Produkt
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Noch keine Produkte. Ein Katalog ist optional — du kannst Positionen auch direkt in der Rechnung eintippen.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Bezeichnung</th>
                <th className="px-4 py-3">Einheit</th>
                <th className="px-4 py-3 text-right">Netto</th>
                <th className="px-4 py-3 text-right">USt</th>
                <th className="px-4 py-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/produkte/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                      {p.name}
                    </Link>
                    {p.differential && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">§ 25a</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.unit}</td>
                  <td className="tabular px-4 py-3 text-right">{formatCents(p.netPriceCents)}</td>
                  <td className="tabular px-4 py-3 text-right">{p.taxRate}%</td>
                  <td className="px-4 py-3 text-right">
                    <form action={archiveProduct} className="inline">
                      <input type="hidden" name="id" value={p.id} />
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
