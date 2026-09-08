import Link from "next/link";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import type { EmailDocType } from "@/schemas/email";

function deDateTime(d: Date | null) {
  return d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(d) : "—";
}
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const STATUS_BADGE: Record<string, string> = {
  SENT: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-700",
  QUEUED: "bg-slate-100 text-slate-700",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  BOUNCED: "bg-rose-100 text-rose-700",
};
const STATUS_LABEL: Record<string, string> = {
  SENT: "Gesendet",
  FAILED: "Fehlgeschlagen",
  QUEUED: "In Warteschlange",
  DELIVERED: "Zugestellt",
  BOUNCED: "Unzustellbar",
};

export async function EmailHistory({ docType, docId }: { docType: EmailDocType; docId: string }) {
  const org = await getActiveOrg();
  const logs = await dbInternal.emailLog.findMany({
    where: { orgId: org.id, docType, docId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">E-Mail-Verlauf</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine E-Mails versendet.</p>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const to = JSON.parse(log.toJson) as string[];
            const cc = JSON.parse(log.ccJson) as string[];
            const bcc = JSON.parse(log.bccJson) as string[];
            const attachments = JSON.parse(log.attachmentsJson) as { filename: string; size: number }[];
            return (
              <div key={log.id} className="space-y-1 border-t border-slate-100 pt-3 text-sm first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[log.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {STATUS_LABEL[log.status] ?? log.status}
                    </span>
                    <span className="text-slate-600">{deDateTime(log.sentAt ?? log.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/emails/${log.id}`} className="text-indigo-600 hover:underline">
                      Ansehen
                    </Link>
                    <SendEmailDialog docType={docType} docId={docId} resendLogId={log.id} label="Erneut senden" />
                  </div>
                </div>
                <p className="text-slate-700">
                  <span className="font-medium">An:</span> {to.join(", ")}
                  {cc.length > 0 && <span className="ml-2 text-slate-500">CC: {cc.join(", ")}</span>}
                  {bcc.length > 0 && <span className="ml-2 text-slate-500">BCC: {bcc.join(", ")}</span>}
                </p>
                <p className="text-slate-700">
                  <span className="font-medium">Betreff:</span> {log.subject}
                </p>
                {attachments.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Anhänge: {attachments.map((a) => `${a.filename} (${formatKb(a.size)})`).join(", ")}
                  </p>
                )}
                {log.status === "FAILED" && log.error && <p className="text-xs text-rose-700">Fehler: {log.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
