import Link from "next/link";
import { getCurrentUserId } from "@/lib/auth/server";
import { getActiveOrg } from "@/lib/org";
import { dashboardSummary } from "@/domain/dashboard/summary";
import { DashboardWidgets } from "@/components/dashboard/DashboardWidgets";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "E-Rechnung-Pflicht 2025–2028",
    body: "XRechnung (UBL/CII) & ZUGFeRD/Factur-X nach EN 16931 — empfangen heute, versenden ab 2027/2028. PDF allein zählt nicht mehr.",
  },
  {
    title: "GoBD-konform",
    body: "Festschreibung statt Bearbeiten, lückenlose Nummernkreise, append-only Audit-Hash-Chain. Festgeschriebene Belege sind unveränderbar.",
  },
  {
    title: "Alle Rechnungstypen",
    body: "Standard, Kleinbetrag (§ 33), Kleinunternehmer (§ 19), Reverse Charge (§ 13b), ig. Lieferung, Differenzbesteuerung (§ 25a).",
  },
  {
    title: "Self-hosted & DSGVO",
    body: "Läuft komplett bei dir — SQLite-Solo ohne Server oder PostgreSQL via Docker. Keine Cloud-Pflicht, keine Vendor-Locks.",
  },
];

function MarketingPage() {
  return (
    <div className="space-y-16">
      <section className="space-y-6">
        <span className="inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Open Source · AGPL-3.0 · kostenlos
        </span>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
          Rechtssichere Rechnungen für Deutschland —{" "}
          <span className="text-indigo-600">für immer kostenlos.</span>
        </h1>
        <p className="max-w-2xl text-lg text-slate-600">
          OpenInvoice Germany ist eine freie, self-hostbare Rechnungssoftware mit E-Rechnung, GoBD und allen
          umsatzsteuerlichen Pflichtangaben. Damit kein Selbstständiger und kein KMU mehr für rechtskonforme
          Rechnungen zahlen muss.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Anmelden
          </Link>
          <a
            href="https://github.com/automationsmanufaktur-labs/open-invoice-germany"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            Quellcode auf GitHub
          </a>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <strong>Hinweis:</strong> Diese Software ist keine Steuer- oder Rechtsberatung. GoBD-Konformität erfordert
        zusätzlich eine Verfahrensdokumentation des Anwenders. Alle rechtlichen Grundlagen mit Quellen findest du in
        der Datei <code className="font-mono">COMPLIANCE.md</code>.
      </section>
    </div>
  );
}

/**
 * Task 4 (Facts): angemeldet -> Dashboard, sonst die bestehende Login-/Marketingseite —
 * ueber den bestehenden Auth-Helfer (src/lib/auth/server), kein Route-Group-Umbau.
 */
export default async function Home() {
  const userId = await getCurrentUserId();
  if (!userId) return <MarketingPage />;

  const org = await getActiveOrg();
  const summary = await dashboardSummary(org.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <Link href="/rechnungen/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neue Rechnung
        </Link>
      </div>
      <DashboardWidgets summary={summary} />
    </div>
  );
}
