/**
 * Leichtgewichtiger Vertrag fuer `export const spec` je Route (Phase 10, Task 2,
 * task-2-facts.md: "Jede Route exportiert `spec` ... fuer die OpenAPI-Registry (Task 4)").
 *
 * Bewusste Vereinfachung fuer Task 2 (siehe task-2-report.md "Deviations"): `response`
 * ist der generische `{data}`/`{data,total,limit,offset}`-Umschlag mit `z.unknown()` als
 * Nutzlast (die tatsaechliche Form steht in den Serialisierern, src/api/serializers/*) —
 * Task 4 baut daraus die detaillierten OpenAPI-Response-Schemas je Ressource. `request`
 * referenziert, wo vorhanden, dieselben Zod-Schemas, die die Route auch selbst zur
 * Validierung nutzt (kein zweites, driftendes Schema).
 */
import "./openapi-zod-init"; // Fix-Runde 1: MUSS vor jedem z.object()-Aufruf hier stehen
import { z } from "zod";

export const apiErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export function apiDataResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema });
}

export function apiListResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({ data: z.array(itemSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
}

export type ApiScope = "read" | "write" | "send" | "admin";

export interface RouteSpec {
  path: string;
  method: "GET" | "POST" | "PATCH";
  summary: string;
  scope: ApiScope;
  request?: { query?: z.ZodTypeAny; body?: z.ZodTypeAny; params?: z.ZodTypeAny };
  response: z.ZodTypeAny;
  errors: number[];
}
