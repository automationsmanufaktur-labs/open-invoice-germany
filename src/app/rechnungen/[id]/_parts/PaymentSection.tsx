// src/app/rechnungen/[id]/_parts/PaymentSection.tsx
import { formatCents } from "@/lib/money";
import { DunningActions } from "@/components/dunning/DunningActions";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { DUNNING_LEVEL_TITLE } from "@/lib/dunning";
import { deDate, type InvoiceDetail } from "./invoice-view-model";

/** Mahnblock (Phase 11d, Task 3) — unveraendert aus der frueheren `page.tsx` (Z. 402-442):
 *  naechste Mahnstufe + Mahnprozess-Status + Aktionen, darunter die bereits verschickten
 *  Mahnungen mit PDF/E-Mail. Wird nur eingebunden, wenn `isInvoiceType && !isDraft &&
 *  !isCancelled` gilt (Aufrufer entscheidet, siehe InvoiceStatusCard). */
export function PaymentSection({
  invoiceId,
  currency,
  openCents,
  isOverdue,
  dueDate,
  dunningState,
  dunningPausedUntil,
  dunningSchedule,
  dunnings,
}: {
  invoiceId: string;
  currency: string;
  openCents: number;
  isOverdue: boolean;
  dueDate: Date;
  dunningState: "ACTIVE" | "PAUSED" | "STOPPED";
  dunningPausedUntil: Date | null;
  dunningSchedule: { nextStage: { name: string; order: number } | null; dueAt: Date | null; isDue: boolean } | null;
  dunnings: InvoiceDetail["dunnings"];
}) {
  return (
    <>
      {openCents > 0 && dunningSchedule && (
        <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-800">
              Mahnprozess:{" "}
              {dunningState === "ACTIVE"
                ? "Aktiv"
                : dunningState === "PAUSED"
                  ? `Pausiert${dunningPausedUntil ? ` bis ${deDate(dunningPausedUntil)}` : ""}`
                  : "Beendet"}
            </span>
            {dunningSchedule.nextStage ? (
              <span className="text-slate-600">
                Nächste Stufe: {dunningSchedule.nextStage.name}
                {dunningSchedule.dueAt && ` · fällig ab ${deDate(dunningSchedule.dueAt)}`}
              </span>
            ) : (
              <span className="text-slate-400">Keine weitere Mahnstufe konfiguriert.</span>
            )}
            {!isOverdue && <span className="text-xs text-slate-400">Fällig am {deDate(dueDate)}</span>}
          </div>
          <DunningActions invoiceId={invoiceId} dunningState={dunningState} hasNextStage={dunningSchedule.nextStage != null} />
        </div>
      )}

      {dunnings.length > 0 && (
        <div className="space-y-1 text-sm">
          {dunnings.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1 text-slate-600">
              <span>
                {d.stage?.name ?? DUNNING_LEVEL_TITLE[d.level] ?? `${d.level}. Mahnung`} · {d.number} · {deDate(d.sentAt)}
                {d.feeCents > 0 ? ` · Mahnkosten ${formatCents(d.feeCents, currency)}` : ""}
                {d.interestAmountCents > 0 ? ` · Zinsen ${formatCents(d.interestAmountCents, currency)}` : ""}
                {d.flatFee40Cents > 0 ? ` · Pauschale ${formatCents(d.flatFee40Cents, currency)}` : ""}
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
    </>
  );
}
