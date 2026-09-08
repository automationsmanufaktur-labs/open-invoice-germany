// src/components/detail/DetailNav.tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Zurueck-Link + Pfeile zum vorherigen/naechsten Beleg der aktuellen Liste.
 *  Tastatur: Alt+Pfeil links/rechts (nicht in Eingabefeldern). */
export function DetailNav({
  backHref,
  backLabel,
  prevHref,
  nextHref,
}: {
  backHref: string;
  backLabel: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && prevHref) {
        e.preventDefault();
        router.push(prevHref);
      }
      if (e.key === "ArrowRight" && nextHref) {
        e.preventDefault();
        router.push(nextHref);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);
  const arrow =
    "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 aria-disabled:opacity-40 aria-disabled:pointer-events-none";
  return (
    <div className="flex items-center gap-2">
      <Link href={backHref} className="text-sm text-slate-500 hover:text-slate-800">
        ← {backLabel}
      </Link>
      <span className="ml-2 inline-flex gap-1">
        <Link href={prevHref ?? "#"} aria-disabled={!prevHref} tabIndex={prevHref ? undefined : -1} onClick={(e) => { if (!prevHref) e.preventDefault(); }} aria-label="Vorheriger Beleg" title="Vorheriger Beleg (Alt+←)" className={arrow}>
          ‹
        </Link>
        <Link href={nextHref ?? "#"} aria-disabled={!nextHref} tabIndex={nextHref ? undefined : -1} onClick={(e) => { if (!nextHref) e.preventDefault(); }} aria-label="Nächster Beleg" title="Nächster Beleg (Alt+→)" className={arrow}>
          ›
        </Link>
      </span>
    </div>
  );
}
