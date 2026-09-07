import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { PartialCreditForm } from "@/components/PartialCreditForm";

export const dynamic = "force-dynamic";

export default async function TeilgutschriftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const inv = await prisma.invoice.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!inv) notFound();

  if (inv.status === "DRAFT") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Eine Teilgutschrift ist erst nach dem Festschreiben möglich.
      </div>
    );
  }

  // Teilgutschrift nur ueber ITEM-Positionen — HEADING/TEXT/SUBTOTAL tragen keinen Betrag
  // und werden hier nicht angeboten (§8, K1).
  const initialLines = inv.lines
    .filter((l) => l.lineType === "ITEM")
    .map((l) => ({
      description: l.description,
      quantity: String(l.quantityMilli / 1000),
      unit: l.unit,
      price: (Math.abs(l.unitNetPriceCents) / 100).toFixed(2),
      taxRate: l.taxRate,
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/rechnungen/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Rechnung {inv.number}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Teilgutschrift</h1>
      </div>
      <PartialCreditForm invoiceId={id} initialLines={initialLines} />
    </div>
  );
}
