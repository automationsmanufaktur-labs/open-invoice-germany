import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUserId } from "@/lib/auth/server";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "OpenInvoice Germany — kostenlose, rechtssichere Rechnungssoftware",
  description:
    "Kostenlose, self-hostbare Open-Source-Rechnungssoftware für Deutschland: E-Rechnung (XRechnung/ZUGFeRD), GoBD, § 14 UStG, Kleinunternehmer § 19.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = Boolean(await getCurrentUserId());

  return (
    <html lang="de">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">
                OI
              </span>
              OpenInvoice <span className="text-slate-400">DE</span>
            </Link>
            {authed && (
              <nav className="flex items-center gap-4 text-sm sm:gap-5">
                <Link href="/rechnungen" className="text-slate-600 hover:text-slate-900">
                  Rechnungen
                </Link>
                <Link href="/kunden" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
                  Kunden
                </Link>
                <Link href="/produkte" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
                  Produkte
                </Link>
                <Link href="/dokumente" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
                  Dokumente
                </Link>
                <Link href="/abos" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
                  Abos
                </Link>
                <Link href="/einstellungen" className="text-slate-600 hover:text-slate-900">
                  Einstellungen
                </Link>
                <Link
                  href="/rechnungen/neu"
                  className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
                >
                  Neue Rechnung
                </Link>
                <LogoutButton />
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-6 py-10 text-xs text-slate-400">
          OpenInvoice Germany · AGPL-3.0 · Keine Steuer-/Rechtsberatung — siehe COMPLIANCE.md
        </footer>
      </body>
    </html>
  );
}
