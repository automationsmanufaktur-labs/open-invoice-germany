// src/components/detail/ActionMenu.tsx
import type { ReactNode } from "react";

/** "Mehr"-Menue ohne Client-JS: <details> mit absolut positionierter Liste. Kinder sind
 *  <ActionMenuItem> mit Link, Button oder <form action=...> (Server Actions bleiben nutzbar). */
export function ActionMenu({ label = "Mehr", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        {label} ▾
      </summary>
      <ul className="absolute right-0 z-30 mt-1 min-w-56 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">{children}</ul>
    </details>
  );
}

export function ActionMenuItem({ children }: { children: ReactNode }) {
  return (
    <li className="[&>a,&>button,&>form>button]:block [&>a,&>button,&>form>button]:w-full [&>a,&>button,&>form>button]:px-3 [&>a,&>button,&>form>button]:py-1.5 [&>a,&>button,&>form>button]:text-left [&>a,&>button,&>form>button]:hover:bg-slate-50">
      {children}
    </li>
  );
}

export function ActionMenuSeparator() {
  return <li className="my-1 border-t border-slate-100" />;
}
