import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: ReactNode;
  /** Buttons/Links rechts (z. B. "Neue Rechnung"). */
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}

/** Einheitlicher Seitenkopf (Phase 11a): Titel links, Aktionen rechts, optional Zurueck-Link. */
export function PageHeader({ title, subtitle, actions, backHref, backLabel }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {backHref && (
          <Link href={backHref} className="text-sm text-slate-500 hover:text-slate-800">
            ← {backLabel ?? "Zurück"}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
