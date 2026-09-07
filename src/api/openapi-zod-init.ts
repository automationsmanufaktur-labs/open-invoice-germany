/**
 * MUSS als ALLERERSTER Import in jedem Modul stehen, das ein Zod-Schema baut, das
 * spaeter in der OpenAPI-Registry verwendet wird (src/api/openapi.ts) — das betrifft
 * `src/api/spec.ts` (apiErrorResponseSchema) UND jedes `src/api/serializers/*.ts`, das
 * einen `*Schema`-Export fuer die Registry bereitstellt.
 *
 * Hintergrund (Fix-Runde 1, Koordinator-Befund — Import-Reihenfolge-Bug, KEINE
 * Zod-4-Inkompatibilitaet): `extendZodWithOpenApi(z)` haengt `.openapi()` NICHT
 * nachtraeglich an bereits VOR dem Aufruf konstruierte Zod-Schema-Instanzen —
 * verifiziert per Spike: zwei `z.object({...})`-Instanzen mit IDENTISCHEM
 * `Object.getPrototypeOf(...)` (`z.ZodObject.prototype`) verhalten sich
 * unterschiedlich, je nachdem ob sie VOR oder NACH `extendZodWithOpenApi(z)`
 * konstruiert wurden — nur die danach gebauten bekommen `.openapi()`. ES-Module-
 * Imports werden VOR dem Modulkoerper ausgewertet: ein `extendZodWithOpenApi(z)`-
 * Aufruf im Top-Level-Code von `src/api/openapi.ts` liefe daher IMMER SPAETER als die
 * Top-Level-`z.object(...)`-Aufrufe in den bereits vorher (auch nur transitiv)
 * importierten Serialisierer-Modulen. Fix: dieses Shim-Modul ALS ERSTES importieren,
 * bevor irgendein Schema in DEMSELBEN Modul gebaut wird — dann garantiert die
 * Ausfuehrungsreihenfolge von ES-Modulen (ein Modul wertet seine eigenen statischen
 * Imports vollstaendig aus, BEVOR sein eigener Koerper laeuft), dass die Erweiterung
 * vor jedem `z.object(...)`-Aufruf in genau dieser Datei bereits aktiv ist —
 * unabhaengig davon, ueber welchen Einstiegspunkt (Route, Skript, Test) die Datei
 * zuerst geladen wird.
 */
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);
