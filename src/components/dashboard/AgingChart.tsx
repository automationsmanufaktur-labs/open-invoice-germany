import type { AgingBucket } from "@/domain/dashboard/summary";
import { formatCents } from "@/lib/money";

/**
 * Reine CSS-Balken (Task-4-Brief: "reine CSS-Balken", keine Chart-Bibliothek/neue
 * Dependency) fuer die Aging-Buckets ueberfaelliger Rechnungen. Fix-Runde 1: nimmt jetzt
 * das generalisierte Bucket-Array entgegen (N+1 Buckets, Labels bereits vom Domain-Helfer
 * `agingBuckets` mitgeliefert) statt der vorherigen festen Vier-Schluessel-Form.
 */
export function AgingChart({ aging }: { aging: AgingBucket[] }) {
  const max = Math.max(1, ...aging.map((b) => b.cents));

  return (
    <div className="space-y-2">
      {aging.map((bucket) => {
        const widthPercent = Math.round((bucket.cents / max) * 100);
        return (
          <div key={bucket.label} className="flex items-center gap-3 text-sm">
            <div className="w-24 shrink-0 text-slate-500">{bucket.label}</div>
            <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
              <div className="h-4 rounded bg-amber-500" style={{ width: `${widthPercent}%` }} />
            </div>
            <div className="w-32 shrink-0 text-right text-slate-700">
              {formatCents(bucket.cents)} <span className="text-slate-400">({bucket.count})</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
