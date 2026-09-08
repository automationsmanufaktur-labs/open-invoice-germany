// src/components/shell/NavIcons.tsx
import type { NavIconName } from "@/lib/nav";

const PATHS: Record<NavIconName, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  quote: "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  order: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  delivery: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  credit: "M4 6h16v12H4zM4 10h16M8 15h3",
  recurring: "M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M18 4v5h-5M6 20v-5h5",
  dunning: "M12 3l9 16H3zM12 10v4M12 17h.01",
  customer: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  product: "M12 3l9 5-9 5-9-5zM3 8v8l9 5 9-5V8",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  bell: "M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6.5 8 4.5 7.5l-1 3 2 1v1l-2 1 1 3 2-.5L8 17.5l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
};

export function NavIcon({ name, className = "h-4 w-4" }: { name: NavIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
