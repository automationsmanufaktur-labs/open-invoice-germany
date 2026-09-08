import Link from "next/link";
import { dbInternal } from "@/lib/db";
import { loadDocumentSettings } from "@/domain/document/settings";
import { ProductForm } from "@/components/forms/ProductForm";
import { NeedOrgNotice } from "@/components/NeedOrgNotice";

export const dynamic = "force-dynamic";

export default async function NeuesProduktPage() {
  const org = await dbInternal.organization.findFirst({ select: { id: true } });
  if (!org) return <NeedOrgNotice />;
  const { taxRates } = await loadDocumentSettings(org.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/produkte" className="text-sm text-slate-500 hover:text-slate-800">
          ← Produkte
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Neues Produkt</h1>
      </div>
      <ProductForm taxRates={taxRates} />
    </div>
  );
}
