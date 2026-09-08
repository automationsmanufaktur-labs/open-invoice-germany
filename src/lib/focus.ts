// src/lib/focus.ts
/**
 * Selektor fuer fokussierbare Elemente innerhalb eines Fokusfallen-Panels (Tab/Shift+Tab
 * bleibt im Dialog) — gemeinsam genutzt von `CommandPalette.tsx`, `Topbar.tsx` (Drawer)
 * und `PreviewSheet.tsx` (Phase 11d, Task 5 Fix 1), damit alle drei denselben Satz an
 * Elementen betrachten statt drei parallel gepflegter Kopien.
 */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, iframe, [tabindex]:not([tabindex="-1"])';

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}
