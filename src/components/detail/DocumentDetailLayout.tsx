// src/components/detail/DocumentDetailLayout.tsx
import type { ReactNode } from "react";

/** Gemeinsamer Rahmen der Belegdetailseiten (Phase 11d): Kopf (Nav, Titel, Badges,
 *  Aktionen, Mehr-Menue), Hinweise, Mitte PDF | rechts Statuskarte, unten volle Breite. */
export function DocumentDetailLayout({
  nav,
  title,
  badges,
  actions,
  more,
  notice,
  pdf,
  aside,
  children,
}: {
  nav: ReactNode;
  title: string;
  badges?: ReactNode;
  actions?: ReactNode;
  more?: ReactNode;
  notice?: ReactNode;
  pdf: ReactNode;
  aside: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {nav}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {badges}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {more}
          </div>
        </div>
      </div>
      {notice}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">{pdf}</div>
        <aside className="space-y-4">{aside}</aside>
      </div>
      {children && <div className="space-y-6">{children}</div>}
    </div>
  );
}
