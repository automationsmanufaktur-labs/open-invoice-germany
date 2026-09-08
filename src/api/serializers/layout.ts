/**
 * /api/v1/Layout (Phase 11b, Task 8) — feste Liste der sieben PDF-Layouts
 * (`src/lib/pdf/layouts/registry.ts#listLayouts`), keine DB-Tabelle. `thumbnailUrl`
 * verweist auf die statischen Vorschaubilder unter `public/layouts/<id>.svg`
 * (dieselben, die die Layout-Galerie unter Einstellungen -> Briefpapier verwendet).
 */
import "../openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { z } from "zod";
import { LAYOUT_IDS, type LayoutId } from "@/lib/pdf/layouts/ids";

export function serializeLayout(l: { id: LayoutId; name: string; description: string }) {
  return { objectName: "Layout" as const, id: l.id, name: l.name, description: l.description, thumbnailUrl: `/layouts/${l.id}.svg` };
}

/** OpenAPI-Response-Schema (Phase 10, Task 4 Muster) — aus serializeLayout abgeleitet. */
export const layoutSchema = z.object({
  objectName: z.literal("Layout"),
  id: z.enum(LAYOUT_IDS),
  name: z.string(),
  description: z.string(),
  thumbnailUrl: z.string(),
});
