import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";

export const dynamic = "force-dynamic";

function deDateTime(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(d) : "—";
}
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: "Gesendet",
  FAILED: "Fehlgeschlagen",
  QUEUED: "In Warteschlange",
  DELIVERED: "Zugestellt",
  BOUNCED: "Unzustellbar",
};

async function backLink(docType: string, docId: string): Promise<string | null> {
  if (docType === "INVOICE" || docType === "CREDIT_NOTE") return `/rechnungen/${docId}`;
  if (docType === "ANGEBOT" || docType === "AUFTRAGSBESTAETIGUNG" || docType === "PROFORMA") return `/dokumente/${docId}`;
  if (docType === "DUNNING") {
    const d = await dbInternal.dunning.findUnique({ where: { id: docId }, select: { invoiceId: true } });
    return d ? `/rechnungen/${d.invoiceId}` : null;
  }
  return null;
}

export default async function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const log = await dbInternal.emailLog.findFirst({ where: { id, orgId: org.id } });
  if (!log) notFound();

  const to = JSON.parse(log.toJson) as string[];
  const cc = JSON.parse(log.ccJson) as string[];
  const bcc = JSON.parse(log.bccJson) as string[];
  const attachments = JSON.parse(log.attachmentsJson) as { filename: string; size: number; sha256: string }[];
  const warnings = JSON.parse(log.warningsJson) as string[];
  const back = await backLink(log.docType, log.docId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {back && (
          <Link href={back} className="text-sm text-slate-500 hover:text-slate-800">
            ← Zurück zum Beleg
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">E-Mail-Details</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Kopfdaten</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-600">
            <dt>Status</dt>
            <dd>{STATUS_LABEL[log.status] ?? log.status}</dd>
            <dt>Gesendet am</dt>
            <dd>{deDateTime(log.sentAt ?? log.createdAt)}</dd>
            <dt>Von</dt>
            <dd>{log.fromEmail}</dd>
            <dt>An</dt>
            <dd>{to.join(", ") || "—"}</dd>
            <dt>CC</dt>
            <dd>{cc.join(", ") || "—"}</dd>
            <dt>BCC</dt>
            <dd>{bcc.join(", ") || "—"}</dd>
            <dt>Betreff</dt>
            <dd>{log.subject}</dd>
          </dl>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Anhänge</h2>
          {attachments.length === 0 ? (
            <p className="text-slate-500">Keine Anhänge.</p>
          ) : (
            <ul className="space-y-1 text-slate-600">
              {attachments.map((a) => (
                <li key={a.sha256}>
                  {a.filename} ({formatKb(a.size)}) —{" "}
                  <code className="text-xs text-slate-400">{a.sha256}</code>
                </li>
              ))}
            </ul>
          )}
          {log.status === "FAILED" && log.error && (
            <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">Fehler: {log.error}</p>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{warnings.join(", ")}</div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-2 font-semibold text-slate-900">Nachricht</h2>
        <pre className="whitespace-pre-wrap text-sm text-slate-700">{log.bodySnapshot}</pre>
      </div>
    </div>
  );
}
