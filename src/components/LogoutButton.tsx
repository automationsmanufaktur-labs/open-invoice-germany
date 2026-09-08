"use client";

import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/shell/NavIcons";

/** `iconOnly` (Abschluss-Review M8): Icon-Button fuer die eingeklappte Sidebar — sonst
 *  gaebe es dort keine Moeglichkeit, sich abzumelden. */
export function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={logout}
        aria-label="Abmelden"
        title="Abmelden"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <NavIcon name="logout" className="h-4 w-4" />
      </button>
    );
  }
  return (
    <button onClick={logout} className="text-slate-500 hover:text-slate-900">
      Abmelden
    </button>
  );
}
