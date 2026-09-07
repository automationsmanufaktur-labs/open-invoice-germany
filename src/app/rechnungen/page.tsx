import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { listInvoices } from "@/domain/invoice/list";
import { availableActions } from "@/domain/document/actions";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { resolveDefaultPaymentMethodCode } from "@/domain/payment-method/default";
import { loadDocumentSettings } from "@/domain/document/settings";
import { formatCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { FilterBar, type FilterField } from "@/components/list/FilterBar";
import { Pagination } from "@/components/list/Pagination";
import { RowActionsMenu } from "@/components/list/RowActionsMenu";
import { loadListPage } from "@/lib/list-page";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift",
  CORRECTION: "Korrektur",
  PARTIAL: "Teilrechnung",
  DOWNPAYMENT: "Abschlagsrechnung",
  FINAL: "Schlussrechnung",
};

const STATUS_OPTIONS: FilterField = {
  type: "select",
  name: "status",
  label: "Status",
  options: [
    { value: "draft", label: "Entwurf" },
    { value: "open", label: "Offen" },
    { value: "due", label: "Fällig heute" },
    { value: "overdue", label: "Überfällig" },
    { value: "partial", label: "Teilbezahlt" },
    { value: "paid", label: "Bezahlt" },
    { value: "cancelled", label: "Storniert" },
  ],
};

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

type SP = Record<string, string | string[] | undefined>;

export default async function RechnungenPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const values: Record<string, string | undefined> = {
    q: firstOf(sp.q),
    status: firstOf(sp.status),
    type: firstOf(sp.type),
    from: firstOf(sp.from),
    to: firstOf(sp.to),
    offset: firstOf(sp.offset),
  };

  const org = await getActiveOrg();
  // Fix-Welle (B1): rohe searchParams enthalten bei jedem FilterBar-Submit leere Strings
  // ("Alle" im <select>) — parseListQuery entfernt sie, ein verbleibender ZodError
  // (handgeschriebene URL, z. B. offset=abc) faengt loadListPage ab statt die Seite
  // abstuerzen zu lassen.
  const result = await loadListPage(sp, (f) => listInvoices(org.id, f), { booleanKeys: ["eInvoice"] });
  const allPaymentMethods = await listPaymentMethods(org.id);
  const activePaymentMethods = allPaymentMethods.filter((m) => m.isActive && m.code !== "SKONTO");
  const paymentMethodOptions = activePaymentMethods.map((m) => ({ code: m.code, name: m.name }));

  // Fix-Runde 1 (Ruling c): Zahlungsart-Vorbelegung je Zeile ueber Kunden-Standard ->
  // Org-Standard -> erste aktive Methode (resolveDefaultPaymentMethodCode) — NICHT mehr
  // hartkodiert die erste aktive Methode der Organisation fuer alle Zeilen. Ein
  // zusaetzlicher Bulk-Query fuer die Kunden-Standardmethoden der aktuellen Seite (kein
  // N+1) statt eines Joins je Zeile.
  const docSettings = await loadDocumentSettings(org.id);
  const orgDefaultCode = docSettings.defaultPaymentMethodId
    ? (allPaymentMethods.find((m) => m.id === docSettings.defaultPaymentMethodId)?.code ?? null)
    : null;
  const customerIds = [...new Set(result.rows.map((r) => r.customerId))];
  const customerDefaults = await dbInternal.customer.findMany({
    where: { orgId: org.id, id: { in: customerIds } },
    select: { id: true, defaultPaymentMethod: { select: { code: true } } },
  });
  const customerDefaultCodeById = new Map(customerDefaults.map((c) => [c.id, c.defaultPaymentMethod?.code ?? null]));

  // Summenzeile offen/ueberfaellig (Task 2, Brief): Summe bezieht sich bewusst nur auf die
  // aktuell angezeigte Seite (nicht die Gesamtmenge des Filters) — eine globale Aggregation
  // ueber ALLE gefilterten Zeilen wuerde eine eigene Aggregat-Query erfordern, die nicht
  // Teil des Task-1-Vertrags (listInvoices liefert nur `rows`+`total`) ist.
  const openSumCents = result.rows.reduce((s, r) => s + (r.effectiveStatus !== "PAID" && r.effectiveStatus !== "CANCELLED" ? r.openCents : 0), 0);
  const overdueSumCents = result.rows.reduce((s, r) => s + (r.effectiveStatus === "OVERDUE" ? r.openCents : 0), 0);

  const fields: FilterField[] = [
    { type: "text", name: "q", label: "Suche", placeholder: "Nummer, Kunde, Position…" },
    STATUS_OPTIONS,
    {
      type: "select",
      name: "type",
      label: "Typ",
      options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
    },
    { type: "date", name: "from", label: "Von" },
    { type: "date", name: "to", label: "Bis" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Rechnungen</h1>
        <Link href="/rechnungen/neu" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Neue Rechnung
        </Link>
      </div>

      <FilterBar basePath="/rechnungen" fields={fields} values={values} />

      {result.total > 0 && (
        <div className="flex flex-wrap gap-4 text-sm text-slate-600">
          <span>
            Offen (diese Seite): <strong className="tabular text-slate-900">{formatCents(openSumCents)}</strong>
          </span>
          <span>
            Überfällig (diese Seite): <strong className="tabular text-rose-700">{formatCents(overdueSumCents)}</strong>
          </span>
        </div>
      )}

      {result.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Keine Rechnungen gefunden.{" "}
          <Link href="/rechnungen/neu" className="font-medium text-indigo-600 hover:underline">
            Lege deine erste Rechnung an.
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Kunde</th>
                <th className="px-4 py-3">Fällig</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Brutto</th>
                <th className="px-4 py-3 text-right">Offen</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.rows.map((inv) => {
                const actions = availableActions({
                  kind: "INVOICE",
                  type: inv.type,
                  status: inv.effectiveStatus,
                  isDraft: inv.effectiveStatus === "DRAFT",
                  hasEmailLog: inv.hasEmailLog,
                  dunningState: inv.dunningState,
                });
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/rechnungen/${inv.id}`} className="font-medium text-indigo-600 hover:underline">
                        {inv.number ?? "Entwurf"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{TYPE_LABEL[inv.type] ?? inv.type}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.customerName}</td>
                    <td className="px-4 py-3 text-slate-600">{deDate(inv.dueDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.effectiveStatus} partiallyPaid={inv.partiallyPaid} />
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">{formatCents(inv.grossTotalCents, inv.currency)}</td>
                    <td className="tabular px-4 py-3 text-right text-slate-600">{formatCents(inv.openCents, inv.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <RowActionsMenu
                        kind="INVOICE"
                        id={inv.id}
                        actions={actions}
                        openHref={`/rechnungen/${inv.id}`}
                        editHref={inv.effectiveStatus === "DRAFT" ? `/rechnungen/${inv.id}/bearbeiten` : undefined}
                        pdfHref={`/api/invoices/${inv.id}/pdf`}
                        xrechnungHref={`/api/invoices/${inv.id}/xrechnung`}
                        emailDocType={inv.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE"}
                        hasEmailLog={inv.hasEmailLog}
                        duplicateRoute={`/api/invoices/${inv.id}/duplicate`}
                        duplicateRedirect="/rechnungen/{id}/bearbeiten"
                        cancelRoute={`/api/invoices/${inv.id}/cancel`}
                        dunningRoute={`/api/invoices/${inv.id}/dunning`}
                        dunningCount={inv.dunningCount}
                        payment={
                          inv.openCents > 0
                            ? {
                                openCents: inv.openCents,
                                methods: paymentMethodOptions,
                                defaultMethod: resolveDefaultPaymentMethodCode({
                                  customerDefaultCode: customerDefaultCodeById.get(inv.customerId),
                                  orgDefaultCode,
                                  activeMethods: paymentMethodOptions,
                                }),
                              }
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination basePath="/rechnungen" searchParams={values} total={result.total} limit={result.limit} offset={result.offset} />
        </div>
      )}
    </div>
  );
}

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
