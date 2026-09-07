import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { resolveShareToken } from "@/domain/quote-share/link";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { formatCents } from "@/lib/money";
import { formatDateDe } from "@/lib/template/format";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { DecisionForm } from "./DecisionForm";
import { LineItemsTable } from "@/components/LineItemsTable";

export const dynamic = "force-dynamic";

const PAGE_RATE_LIMIT = 60;
const PAGE_RATE_WINDOW_MS = 60_000;

const KIND_TITLE: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma-Rechnung",
};

/**
 * Oeffentliche Angebotsseite (kein Login, Phase 3b). Zeigt AUSSCHLIESSLICH Daten aus
 * `resolveShareToken` (Seller-Snapshot, Positionen, Betraege, Kopf-/Fusstext) — nie
 * `internalNotes`, nie Kundendaten ueber die Adresse hinaus, nie Org-IDs. `null` (jeder
 * Ungueltigkeitsfall: unbekannt/abgelaufen/widerrufen/archiviert) fuehrt einheitlich zu
 * 404, ohne Unterscheidung (Sicherheitsregel).
 */
export default async function AngebotPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // W4: Rate-Limit je IP fuer die oeffentliche Lesevariante der Seite.
  const h = await headers();
  const ip = clientIpFromHeaders(h) ?? undefined;
  if (ip) {
    try {
      rateLimit(`public:ip:${ip}`, { limit: PAGE_RATE_LIMIT, windowMs: PAGE_RATE_WINDOW_MS });
    } catch (e) {
      if (e instanceof RateLimitError) {
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
            <p className="text-lg font-medium text-amber-900">Zu viele Anfragen</p>
            <p className="mt-2 text-sm text-amber-700">Bitte versuchen Sie es in Kuerze erneut.</p>
          </div>
        );
      }
      throw e;
    }
  }

  const resolved = await resolveShareToken(token);
  if (!resolved) notFound();

  const { link, quote } = resolved;
  const data = buildDocEInvoiceData(quote);

  if (link.decidedAt) {
    const decisionLabel = link.decision === "ACCEPTED" ? "angenommen" : "abgelehnt";
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {KIND_TITLE[quote.kind] ?? "Dokument"} {data.number}
        </h1>
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-lg font-medium text-slate-900">
            Vielen Dank, Ihr Angebot wurde am {formatDateDe(link.decidedAt)} {decisionLabel}.
          </p>
          <p className="mt-2 text-sm text-slate-500">Eine weitere Entscheidung ueber diesen Link ist nicht mehr moeglich.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {KIND_TITLE[quote.kind] ?? "Dokument"} {data.number}
        </h1>
        <a
          href={`/api/public/angebot/${token}/pdf`}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          PDF herunterladen
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Absender</h2>
          <p className="text-slate-700">{data.seller.name}</p>
          <p className="text-slate-600">{data.seller.addressLine1}</p>
          <p className="text-slate-600">
            {data.seller.postalCode} {data.seller.city}
          </p>
          {data.seller.email && <p className="text-slate-600">{data.seller.email}</p>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Eckdaten</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-slate-600">
            <dt>Angebotsnummer</dt>
            <dd className="text-right">{data.number}</dd>
            <dt>Datum</dt>
            <dd className="text-right">{formatDateDe(data.issueDate)}</dd>
            {quote.validUntil && (
              <>
                <dt>Gültig bis</dt>
                <dd className="text-right">{formatDateDe(quote.validUntil)}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {data.headerText && <p className="whitespace-pre-line text-sm text-slate-700">{data.headerText}</p>}

      <LineItemsTable lines={data.lines} currency={data.currency} />

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Netto</span>
          <span className="tabular font-medium">{formatCents(data.netTotalCents, data.currency)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>zzgl. USt</span>
          <span className="tabular">{formatCents(data.taxTotalCents, data.currency)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
          <span>Gesamt</span>
          <span className="tabular">{formatCents(data.grossTotalCents, data.currency)}</span>
        </div>
      </div>

      {data.footerText && <p className="whitespace-pre-line text-sm text-slate-700">{data.footerText}</p>}

      <DecisionForm token={token} />
    </div>
  );
}
