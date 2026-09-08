import { redirect } from "next/navigation";
import { dbInternal } from "@/lib/db";
import { AuthForm } from "@/components/AuthForm";
import { safeBrand } from "@/domain/settings/brand";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  if ((await dbInternal.user.count()) === 0) redirect("/setup");
  const brand = await safeBrand();
  return <AuthForm mode="login" redirectTo={from || "/rechnungen"} appName={brand.appName} />;
}
