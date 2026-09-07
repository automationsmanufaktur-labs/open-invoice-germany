import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ProductForm } from "@/components/forms/ProductForm";

export const dynamic = "force-dynamic";

export default async function ProduktBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const product = await prisma.product.findFirst({ where: { id, orgId: org.id } });
  if (!product) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/produkte" className="text-sm text-slate-500 hover:text-slate-800">
          ← Produkte
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Produkt bearbeiten</h1>
      </div>
      <ProductForm product={product} />
    </div>
  );
}
