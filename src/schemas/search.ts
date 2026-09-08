import { z } from "zod";

/** Phase 11a — Query der globalen Suche (`GET /api/search`). */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Mindestens 2 Zeichen").max(80),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
