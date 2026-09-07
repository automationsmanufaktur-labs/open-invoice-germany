/**
 * /api/v1/Settings — Einstellungen (task-2-facts.md Registry, singulaere Ressource: kein
 * [id]-Unterpfad, siehe task-2-report.md "Deviations"). Buendelt die drei bestehenden
 * Fragment-Domains (Dokument-/Briefpapier-/Druckeinstellungen) unter je einem Schluessel.
 * Scope: `admin` fuer GET UND PATCH (Brief-Ruling "admin fuer ApiKey/Settings" — anders
 * als der sonstige read/write-Split).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { loadDocumentSettings, saveDocumentSettings } from "@/domain/document/settings";
import { loadBrandingSettings, saveBrandingSettings } from "@/domain/settings/branding";
import { loadPrintSettings, savePrintSettings } from "@/domain/settings/print";
import { documentSettingsInputSchema, brandingSettingsInputSchema, printSettingsInputSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadAll(orgId: string) {
  const [documents, branding, print] = await Promise.all([loadDocumentSettings(orgId), loadBrandingSettings(orgId), loadPrintSettings(orgId)]);
  return { objectName: "Settings" as const, documents, branding, print };
}

export const GET = withApi(async (_req, ctx) => {
  return apiData(await loadAll(ctx.orgId));
}, { scope: "admin" });

const patchBodySchema = z.object({
  documents: documentSettingsInputSchema.partial().optional(),
  branding: brandingSettingsInputSchema.partial().optional(),
  print: printSettingsInputSchema.partial().optional(),
});

/**
 * Fix-Welle (Blocking 1): `documentSettingsInputSchema.partial()` etc. machen jedes Feld
 * OPTIONAL, aber jedes Feld traegt bereits `.default(...)` (dieselben Schemas erzeugen
 * auch `DEFAULT_*_SETTINGS`) — beim Parsen wird ein FEHLENDES Feld deshalb trotzdem mit
 * seinem Default befuellt, NICHT einfach weggelassen (`.optional()` wrapt hier aussen um
 * ein bereits defaultetes Feld, das Default greift also weiterhin bei Abwesenheit).
 * `parsed` (das Ergebnis von `xSchema.partial().parse(raw)`) enthaelt daher IMMER alle
 * Felder — nicht nur die tatsaechlich gesendeten. Nur die Feldnamen, die im ROHEN
 * (ungeparsten) Request-Body wirklich vorkommen, duerfen den geladenen Stand ueberschreiben;
 * alle anderen Schluessel in `parsed` sind Defaults, keine Nutzereingabe, und wuerden bei
 * direktem Spread ueber `current` echte, gespeicherte Werte stillschweigend loeschen.
 */
function mergeSentFields<T extends Record<string, unknown>>(current: T, raw: unknown, parsed: Partial<T>): T {
  if (!raw || typeof raw !== "object") return current;
  const merged: T = { ...current };
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (key in parsed) (merged as Record<string, unknown>)[key] = (parsed as Record<string, unknown>)[key];
  }
  return merged;
}

export const PATCH = withApi(async (_req, ctx) => {
  const v = patchBodySchema.parse(ctx.body);
  const raw = (ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {}) as Record<string, unknown>;

  if (v.documents) {
    const current = await loadDocumentSettings(ctx.orgId);
    await saveDocumentSettings(ctx.orgId, mergeSentFields(current, raw.documents, v.documents));
  }
  if (v.branding) {
    const current = await loadBrandingSettings(ctx.orgId);
    await saveBrandingSettings(ctx.orgId, mergeSentFields(current, raw.branding, v.branding));
  }
  if (v.print) {
    const current = await loadPrintSettings(ctx.orgId);
    await savePrintSettings(ctx.orgId, mergeSentFields(current, raw.print, v.print));
  }
  return apiData(await loadAll(ctx.orgId));
}, { scope: "admin" });

export const spec = {
  get: {
    path: "/api/v1/Settings",
    method: "GET",
    summary: "Einstellungen abrufen (Dokumente/Briefpapier/Druck)",
    scope: "admin",
    response: apiDataResponseSchema(z.unknown()),
    errors: [401, 403, 429],
  },
  update: {
    path: "/api/v1/Settings",
    method: "PATCH",
    summary: "Einstellungsfragmente aktualisieren",
    scope: "admin",
    request: { body: patchBodySchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
