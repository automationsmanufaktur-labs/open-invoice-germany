/**
 * Layout-Register (Phase 11b): loest eine `LayoutId` auf ein `PdfLayout` auf, mit
 * `standard` als Fallback. Seit Task 5 ein vollstaendiges `Record<LayoutId, PdfLayout>`
 * — alle sieben Layouts sind fest verdrahtet, kein `registerLayout` mehr noetig.
 */
import { DEFAULT_LAYOUT_ID, LAYOUT_IDS, isLayoutId, type LayoutId } from "./ids";
import type { PdfLayout } from "./types";
import { standardLayout } from "./standard";
import { schlichtLayout } from "./schlicht";
import { klassikLayout } from "./klassik";
import { modernLayout } from "./modern";
import { blauLayout, schwarzLayout, kompaktLayout } from "./styled";

const LAYOUTS: Record<LayoutId, PdfLayout> = {
  standard: standardLayout,
  schlicht: schlichtLayout,
  klassik: klassikLayout,
  modern: modernLayout,
  blau: blauLayout,
  schwarz: schwarzLayout,
  kompakt: kompaktLayout,
};

export function getLayout(id: string | null | undefined): PdfLayout {
  if (isLayoutId(id)) return LAYOUTS[id];
  return LAYOUTS[DEFAULT_LAYOUT_ID];
}

export function listLayouts(): { id: LayoutId; name: string; description: string }[] {
  return LAYOUT_IDS.map((id) => ({ id, name: LAYOUTS[id].name, description: LAYOUTS[id].description }));
}
