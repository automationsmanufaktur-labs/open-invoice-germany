// src/components/shell/NavHint.tsx
"use client";

import { useEffect } from "react";
import { useShell } from "./ShellProvider";

/** Detailseiten ohne eigenen Listen-Pfad (z. B. /dokumente/<id> einer AB) melden der
 *  Sidebar den Listen-Link, der als aktiv gelten soll (11a-M12). Rendert nichts. */
export function NavHint({ href }: { href: string }) {
  const { setNavHint } = useShell();
  useEffect(() => {
    setNavHint(href);
    return () => setNavHint(null);
  }, [href, setNavHint]);
  return null;
}
