// src/components/detail/CollapsibleSection.tsx
import type { ReactNode } from "react";

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900">
        <span>{title}</span>
        {summary && <span className="font-normal text-slate-500">{summary}</span>}
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}
