import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { formatCents } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { finalizeAction, cancelAction } from "@/app/actions/invoices";
import { PaymentForm } from "@/components/PaymentForm";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { DunningButton } from "@/components/DunningButton";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { EmailHistory } from "@/components/EmailHistory";
import { ConvertMenu } from "@/components/ConvertMenu";
import { DocumentChain } from "@/components/DocumentChain";
import { DUNNING_LEVEL_TITLE } from "@/lib/dunning";
import type { EmailDocType } from "@/schemas/email";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { listAttachments } from "@/domain/attachment/manage";
import { LineItemsTable } from "@/components/LineItemsTable";
import { DuplicateInvoiceButton } from "@/components/DuplicateInvoiceButton";
import { payableBaseCents, openAmountCents } from "@/domain/invoice/amounts";

export const dynamic = "force-dynamic";

// Task 4: PARTIAL/DOWNPAYMENT/FINAL sind rechtlich ebenfalls Rechnungen (§13-15 UStG).
const TYPE_TITLE: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift / Storno",
  CORRECTION: "Korrekturrechnung",
  PARTIAL: "Teilrechnung",
  DOWNPAYMENT: "Abschlagsrechnung",
  FINAL: "Schlussrechnung",
};

// §16-Aktionsblock: Rechnungen aller Art (ausser Gutschrift/Storno selbst) koennen
// storniert oder (teil-)gutgeschrieben werden (Task-2-Domain: cancelInvoice/
// createPartialCreditNote pruefen nur `type !== "CREDIT_NOTE"`, nicht auf INVOICE
// eingeschraenkt) — PARTIAL/DOWNPAYMENT/FINAL eingeschlossen.
const CANCELLABLE_TYPES = new Set(["INVOICE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);
const CREDITABLE_TYPES = CANCELLABLE_TYPES;
// Duplizieren ist fuer PARTIAL/DOWNPAYMENT/FINAL verboten (InvalidOperationError, Task 2)
// — haengen an einer Quelle (sourceType/sourceId), ein Duplikat waere weder eine neue
// Teilleistung noch ein neuer Abschlag/Schluss.
const NOT_DUPLICATABLE_TYPES = new Set(["PARTIAL", "DOWNPAYMENT", "FINAL"]);

function deDate(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export default async function InvoiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const org = await getActiveOrg();
  // G7 (Fix-Runde 2): findUnique(id) ohne orgId erlaubte fremden Organisationen den Zugriff
  // auf eine Rechnungsseite ueber die reine ID — jetzt mandantengeprueft.
  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId: org.id },
    include: {
      lines: { orderBy: { position: "asc" } },
      customer: { include: { defaultPaymentMethod: true } },
      org: true,
      payments: { orderBy: { paidAt: "asc" } },
      dunnings: { orderBy: { level: "asc" } },
      paymentMethod: true,
      // Task 4: Abzugs-Snapshot einer Schlussrechnung (Task 2, FinalInvoiceDeduction) —
      // NIE live aus den Abschlagsrechnungen, nur dieser unveraenderliche Snapshot.
      finalDeductions: { orderBy: { issueDate: "asc" } },
    },
  });
  if (!invoice) notFound();

  // Task 4: Bezug zur Quelle (Angebot/AB bzw. Lieferschein) bei PARTIAL/DOWNPAYMENT/FINAL.
  let sourceLabel: { href: string; text: string } | null = null;
  if (invoice.sourceType === "QUOTE" && invoice.sourceId) {
    const src = await prisma.quote.findFirst({ where: { id: invoice.sourceId, orgId: org.id }, select: { number: true, kind: true } });
    if (src) {
      const kindLabel = src.kind === "AUFTRAGSBESTAETIGUNG" ? "Auftragsbestätigung" : src.kind === "PROFORMA" ? "Proforma-Rechnung" : "Angebot";
      sourceLabel = { href: `/dokumente/${invoice.sourceId}`, text: `${kindLabel} ${src.number ?? ""}`.trim() };
    }
  } else if (invoice.sourceType === "DELIVERY_NOTE" && invoice.sourceId) {
    const src = await prisma.deliveryNote.findFirst({ where: { id: invoice.sourceId, orgId: org.id }, select: { number: true } });
    if (src) sourceLabel = { href: `/lieferscheine/${invoice.sourceId}`, text: `Lieferschein ${src.number ?? ""}`.trim() };
  }

  const isDraft = invoice.status === "DRAFT";
  const isCancelled = invoice.status === "CANCELLED";
  const breakdown = JSON.parse(invoice.taxBreakdownJson) as Array<{
    taxRate: number;
    netCents: number;
    taxCents: number;
    allowanceCents?: number;
    chargeCents?: number;
  }>;
  const hasDocumentAdjustment =
    invoice.documentDiscountPermille > 0 ||
    invoice.documentDiscountCents > 0 ||
    invoice.documentChargePermille > 0 ||
    invoice.documentChargeCents > 0;
  const documentDiscountTotalCents = breakdown.reduce((s, b) => s + (b.allowanceCents ?? 0), 0);
  const documentChargeTotalCents = breakdown.reduce((s, b) => s + (b.chargeCents ?? 0), 0);
  const hasSkonto = invoice.skonto1Permille != null && invoice.skonto1Days != null;
  const paymentMethodName = invoice.paymentMethodSnapshotJson
    ? (JSON.parse(invoice.paymentMethodSnapshotJson) as { name: string }).name
    : (invoice.paymentMethod?.name ?? null);
  // Task 4: PARTIAL/DOWNPAYMENT sind wie INVOICE/CORRECTION regulaer zahlbar; FINAL
  // ebenso, aber auf Basis von `payableCents` (Rest nach Abzug der Abschlaege) statt
  // `grossTotalCents` — payableBaseCents/openAmountCents (Task 2) kapseln das.
  const isInvoiceType = invoice.type === "INVOICE" || invoice.type === "CORRECTION" || invoice.type === "PARTIAL" || invoice.type === "DOWNPAYMENT" || invoice.type === "FINAL";
  const payableBase = payableBaseCents(invoice);
  const openCents = openAmountCents(invoice);
  const dueDate = invoice.dueDate ?? invoice.issueDate;
  const isOverdue = !isDraft && !isCancelled && openCents > 0 && new Date() > dueDate;
  const canPay = !isDraft && !isCancelled && isInvoiceType && openCents > 0;
  const emailDocType: EmailDocType = invoice.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE";

  // Task 4: Abzugsblock einer Schlussrechnung — je Abschlagsrechnung EINE Zeile (ueber
  // alle Steuersaetze aggregiert), aus dem unveraenderlichen FinalInvoiceDeduction-
  // Snapshot (Task 2), niemals live aus den Abschlagsrechnungen selbst.
  const deductionsByInvoice = new Map<string, { number: string; issueDate: Date; netCents: number; taxCents: number; grossCents: number }>();
  for (const d of invoice.finalDeductions) {
    const existing = deductionsByInvoice.get(d.downpaymentInvoiceId);
    if (existing) {
      existing.netCents += d.netCents;
      existing.taxCents += d.taxCents;
      existing.grossCents += d.grossCents;
    } else {
      deductionsByInvoice.set(d.downpaymentInvoiceId, { number: d.number, issueDate: d.issueDate, netCents: d.netCents, taxCents: d.taxCents, grossCents: d.grossCents });
    }
  }

  // Zahlungsmethoden-Auswahl im Zahlungsformular: aktive Methoden OHNE den Systemcode
  // SKONTO (der wird ausschliesslich automatisch bei detectSkonto gebucht, nie manuell
  // ausgewaehlt). Default-Kette: Kunden-Standard -> Methode der Rechnung -> TRANSFER.
  const activePaymentMethods = canPay
    ? (await listPaymentMethods(org.id)).filter((m) => m.isActive && m.code !== "SKONTO")
    : [];
  const defaultPaymentMethodCode = invoice.customer.defaultPaymentMethod?.code ?? invoice.paymentMethod?.code ?? "TRANSFER";
  const attachments = await listAttachments(org.id, "INVOICE", invoice.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/rechnungen" className="text-sm text-slate-500 hover:text-slate-800">
            ← Rechnungen
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {TYPE_TITLE[invoice.type] ?? "Beleg"} {invoice.number ?? "(Entwurf)"}
          </h1>
          <StatusBadge status={invoice.status} />
          {sourceLabel && (
            <Link href={sourceLabel.href} className="text-sm text-indigo-600 hover:underline">
              zu {sourceLabel.text}
            </Link>
          )}
          {invoice.snapshotSource === "MIGRATION" && (
            <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Adressstand per Migration eingefroren
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDF
          </a>
          {!isDraft && (
            <a
              href={`/api/invoices/${invoice.id}/xrechnung`}
              target="_blank"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              XRechnung (XML)
            </a>
          )}
          {!isDraft && (
            <a
              href={`/api/invoices/${invoice.id}/zugferd`}
              target="_blank"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ZUGFeRD (PDF)
            </a>
          )}
          <SendEmailDialog docType={emailDocType} docId={invoice.id} label={isDraft ? "Entwurf per E-Mail senden" : "Per E-Mail senden"} />
          {isDraft && (
            <Link
              href={`/rechnungen/${invoice.id}/bearbeiten`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Bearbeiten
            </Link>
          )}
          {isDraft && (
            <form action={finalizeAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                Festschreiben
              </button>
            </form>
          )}
          {!isDraft && !isCancelled && isInvoiceType && <ConvertMenu sourceType="INVOICE" sourceId={invoice.id} showToDeliveryNote />}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm whitespace-pre-line text-rose-800">{error}</div>
      )}
      {isDraft && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Entwurf — noch keine Rechnungsnummer vergeben. Mit „Festschreiben“ wird die Rechnung GoBD-konform unveränderbar.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Empfänger</h2>
          <p className="text-slate-700">{invoice.customer.name}</p>
          <p className="text-slate-600">{invoice.customer.addressLine1}</p>
          <p className="text-slate-600">
            {invoice.customer.postalCode} {invoice.customer.city}
          </p>
          {invoice.customer.vatId && <p className="text-slate-500">USt-IdNr.: {invoice.customer.vatId}</p>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Eckdaten</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-slate-600">
            <dt>Rechnungsdatum</dt>
            <dd className="text-right">{deDate(invoice.issueDate)}</dd>
            <dt>Leistungsdatum</dt>
            <dd className="text-right">{deDate(invoice.deliveryDate)}</dd>
            <dt>Fällig</dt>
            <dd className="text-right">{deDate(invoice.dueDate)}</dd>
            <dt>Steuerschema</dt>
            <dd className="text-right">{invoice.taxScheme}</dd>
            {paymentMethodName && (
              <>
                <dt>Zahlungsmethode</dt>
                <dd className="text-right">{paymentMethodName}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {invoice.headerText && <p className="whitespace-pre-line text-sm text-slate-700">{invoice.headerText}</p>}

      <LineItemsTable lines={invoice.lines} currency={invoice.currency} />

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        {hasDocumentAdjustment && (
          <>
            {/* Gutschriften spiegeln die Betraege (negativ). Anzeige vorzeichenrichtig
                (analog invoice-pdf.ts); der Grund gehoert nur zum Aufschlag. */}
            {documentDiscountTotalCents !== 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Belegrabatt</span>
                <span className="tabular">{formatCents(-documentDiscountTotalCents, invoice.currency)}</span>
              </div>
            )}
            {documentChargeTotalCents !== 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Belegaufschlag{invoice.documentChargeReason ? ` (${invoice.documentChargeReason})` : ""}</span>
                <span className="tabular">{formatCents(documentChargeTotalCents, invoice.currency)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between">
          <span className="text-slate-600">Netto</span>
          <span className="tabular font-medium">{formatCents(invoice.netTotalCents, invoice.currency)}</span>
        </div>
        {breakdown
          .filter((b) => b.taxCents > 0)
          .map((b) => (
            <div key={b.taxRate} className="flex justify-between text-slate-600">
              <span>zzgl. {b.taxRate}% USt</span>
              <span className="tabular">{formatCents(b.taxCents, invoice.currency)}</span>
            </div>
          ))}
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
          <span>{invoice.type === "FINAL" ? "Gesamtleistung" : "Gesamt"}</span>
          <span className="tabular">{formatCents(invoice.grossTotalCents, invoice.currency)}</span>
        </div>
        {invoice.type === "FINAL" && deductionsByInvoice.size > 0 && (
          <>
            {[...deductionsByInvoice.values()].map((d) => (
              <div key={d.number} className="flex justify-between text-slate-600">
                <span>
                  abzüglich Abschlagsrechnung {d.number} vom {deDate(d.issueDate)}
                </span>
                <span className="tabular">
                  −{formatCents(d.grossCents, invoice.currency)} (enthaltene USt {formatCents(d.taxCents, invoice.currency)})
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
              <span>Restbetrag</span>
              <span className="tabular">{formatCents(payableBase, invoice.currency)}</span>
            </div>
          </>
        )}
      </div>

      {hasSkonto && (
        <div className="ml-auto max-w-xs rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <span className="font-medium text-slate-800">Skonto: </span>
          {(invoice.skonto1Permille! / 10).toString().replace(".", ",")} % bei Zahlung innerhalb {invoice.skonto1Days} Tagen
          {invoice.skonto2Permille != null && invoice.skonto2Days != null && (
            <>
              , {(invoice.skonto2Permille / 10).toString().replace(".", ",")} % innerhalb {invoice.skonto2Days} Tagen
            </>
          )}
          .
        </div>
      )}

      {invoice.footerText && <p className="whitespace-pre-line text-sm text-slate-700">{invoice.footerText}</p>}
      {invoice.notes && <p className="text-sm text-slate-600">{invoice.notes}</p>}

      {invoice.internalNotes && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="mr-2 font-medium">Interne Notiz</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">nur intern sichtbar</span>
          <p className="mt-1 whitespace-pre-line">{invoice.internalNotes}</p>
        </div>
      )}

      {isInvoiceType && !isDraft && !isCancelled && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-slate-900">Zahlung & Mahnwesen</h2>
            <span className="text-sm text-slate-600">
              Bezahlt: {formatCents(invoice.paidAmountCents, invoice.currency)} · Offen:{" "}
              <strong>{formatCents(openCents, invoice.currency)}</strong>
              {isOverdue && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">überfällig</span>}
            </span>
          </div>

          {canPay && (
            <PaymentForm
              invoiceId={invoice.id}
              openCents={openCents}
              methods={activePaymentMethods.map((m) => ({ code: m.code, name: m.name }))}
              defaultMethod={defaultPaymentMethodCode}
            />
          )}

          {invoice.payments.length > 0 && (
            <div className="space-y-1 text-sm">
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1 text-slate-600">
                  <span>
                    {deDate(p.paidAt)} · {formatCents(p.amountCents, invoice.currency)} · {p.method}
                    {p.isSkonto && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Skonto</span>}
                  </span>
                  {p.reference && <span className="text-xs text-slate-400">{p.reference}</span>}
                </div>
              ))}
            </div>
          )}

          {openCents > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <DunningButton invoiceId={invoice.id} />
              {!isOverdue && <span className="text-xs text-slate-400">Fällig am {deDate(dueDate)}</span>}
            </div>
          )}

          {invoice.dunnings.length > 0 && (
            <div className="space-y-1 text-sm">
              {invoice.dunnings.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1 text-slate-600">
                  <span>
                    {DUNNING_LEVEL_TITLE[d.level] ?? `${d.level}. Mahnung`} · {d.number} · {deDate(d.sentAt)}
                    {d.interestAmountCents > 0 ? ` · Zinsen ${formatCents(d.interestAmountCents, invoice.currency)}` : ""}
                    {d.flatFee40Cents > 0 ? ` · Pauschale ${formatCents(d.flatFee40Cents, invoice.currency)}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <a href={`/api/dunnings/${d.id}/pdf`} target="_blank" className="text-indigo-600 hover:underline">
                      PDF
                    </a>
                    <SendEmailDialog docType="DUNNING" docId={d.id} label="Mahnung senden" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!isDraft && !isCancelled && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="font-semibold text-slate-900">Korrektur &amp; Vervielfältigung (§14c, §17 UStG)</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="font-medium text-slate-800">Stornieren</p>
              <p className="text-slate-600">
                Storniert die Rechnung vollständig durch eine Gutschrift in gleicher Höhe (bei einer Schlussrechnung nur in Höhe des Restbetrags nach Abzug der Abschläge). Das Original bleibt unverändert erhalten (GoBD).
              </p>
              {CANCELLABLE_TYPES.has(invoice.type) ? (
                <form action={cancelAction}>
                  <input type="hidden" name="id" value={invoice.id} />
                  <button className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50">Stornieren</button>
                </form>
              ) : (
                <span className="text-xs text-slate-400">Nicht möglich für {TYPE_TITLE[invoice.type] ?? invoice.type}.</span>
              )}
            </div>

            <div className="space-y-1">
              <p className="font-medium text-slate-800">Teilgutschrift</p>
              <p className="text-slate-600">
                Reduziert die Rechnung um frei wählbare Positionen (z. B. eine nachträgliche Preis- oder Mengenkorrektur), ohne sie vollständig zu stornieren.
              </p>
              {CREDITABLE_TYPES.has(invoice.type) ? (
                <Link
                  href={`/rechnungen/${invoice.id}/teilgutschrift`}
                  className="inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Teilgutschrift
                </Link>
              ) : (
                <span className="text-xs text-slate-400">Nicht möglich für {TYPE_TITLE[invoice.type] ?? invoice.type}.</span>
              )}
            </div>

            <div className="space-y-1">
              <p className="font-medium text-slate-800">Korrekturrechnung</p>
              <p className="text-slate-600">
                Für die Berichtigung von § 14 Abs. 4 UStG-Pflichtangaben (z. B. Anschrift, Steuernummer) ohne Änderung der Beträge.
              </p>
              <span className="text-xs text-slate-400">Noch nicht als eigener Beleg-Workflow verfügbar.</span>
            </div>

            <div className="space-y-1">
              <p className="font-medium text-slate-800">Duplizieren</p>
              <p className="text-slate-600">Legt einen neuen Rechnungsentwurf mit denselben Positionen/Konditionen an (z. B. für eine Folgerechnung an denselben Kunden).</p>
              <DuplicateInvoiceButton
                invoiceId={invoice.id}
                disabled={NOT_DUPLICATABLE_TYPES.has(invoice.type)}
                disabledReason={NOT_DUPLICATABLE_TYPES.has(invoice.type) ? "Teil-/Abschlags-/Schlussrechnungen hängen an einer Quelle" : undefined}
              />
            </div>
          </div>
        </section>
      )}

      <AttachmentPanel
        docType="INVOICE"
        docId={invoice.id}
        initial={attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, sizeBytes: a.sizeBytes }))}
      />

      <DocumentChain orgId={org.id} type="INVOICE" id={invoice.id} />

      <EmailHistory docType={emailDocType} docId={invoice.id} />
    </div>
  );
}
