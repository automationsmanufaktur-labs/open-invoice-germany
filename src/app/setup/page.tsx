import { redirect } from "next/navigation";
import { dbInternal } from "@/lib/db";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await dbInternal.user.count()) > 0) redirect("/login");
  return <AuthForm mode="setup" redirectTo="/einstellungen" />;
}
