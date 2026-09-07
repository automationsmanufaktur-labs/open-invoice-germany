/**
 * Benutzerdefinierte Kundenfelder (Phase 8a, Task 1, §31) — Definitionen je Organisation
 * (CustomFieldDefinition) und deren Werte je Kunde (Customer.customFieldsJson).
 *
 * Loeschen einer Definition entfernt bestehende Werte NICHT aus dem gespeicherten JSON
 * (Betreiber-Ruling, siehe Brief) — `parseCustomerCustomFields` ignoriert beim Lesen
 * einfach Keys, zu denen keine (mehr existierende) Definition passt, statt strikt zu
 * validieren. `setCustomerCustomFields` (Schreiben) nutzt dagegen das strikte
 * `customFieldValuesSchema` und lehnt unbekannte Keys/Tippfehler ab.
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import {
  customFieldDefinitionInputSchema,
  customFieldsReorderSchema,
  customFieldValuesSchema,
  type CustomFieldDefinitionLike,
  type CustomFieldType,
} from "@/schemas";

type CustomFieldDefinitionRow = {
  id: string;
  orgId: string;
  key: string;
  label: string;
  type: string;
  optionsJson: string | null;
  required: boolean;
  sortOrder: number;
  isActive: boolean;
};

function toLike(def: CustomFieldDefinitionRow): CustomFieldDefinitionLike {
  let options: string[] | undefined;
  if (def.optionsJson) {
    try {
      const parsed: unknown = JSON.parse(def.optionsJson);
      options = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : undefined;
    } catch {
      options = undefined;
    }
  }
  return { key: def.key, label: def.label, type: def.type as CustomFieldType, options, required: def.required };
}

/** Alle Kundenfeld-Definitionen einer Organisation, aufsteigend nach sortOrder. */
export async function listCustomFieldDefinitions(orgId: string, opts: { activeOnly?: boolean } = {}) {
  return dbInternal.customFieldDefinition.findMany({
    where: { orgId, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Legt eine Definition an (kein `id`) oder aktualisiert sie (mit `id`). `key` ist je
 * Organisation eindeutig (@@unique([orgId, key])) — ein Konflikt wirft
 * InvalidOperationError (409), nicht die generische Prisma-Unique-Fehlermeldung.
 */
export async function upsertCustomFieldDefinition(orgId: string, rawInput: unknown, id?: string) {
  const input = customFieldDefinitionInputSchema.parse(rawInput);

  const conflict = await dbInternal.customFieldDefinition.findFirst({
    where: { orgId, key: input.key, ...(id ? { id: { not: id } } : {}) },
  });
  if (conflict) {
    throw new InvalidOperationError(`Kundenfeld-Schluessel "${input.key}" ist in dieser Organisation bereits vergeben.`);
  }

  const data = {
    key: input.key,
    label: input.label,
    type: input.type,
    optionsJson: input.options ? JSON.stringify(input.options) : null,
    required: input.required,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };

  if (id) {
    const existing = await dbInternal.customFieldDefinition.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundError("Kundenfeld nicht gefunden.");
    return dbInternal.customFieldDefinition.update({ where: { id }, data });
  }
  return dbInternal.customFieldDefinition.create({ data: { orgId, ...data } });
}

/** Loescht eine Definition. Bestehende Werte im Customer.customFieldsJson bleiben (siehe Modulkommentar). */
export async function deleteCustomFieldDefinition(orgId: string, id: string): Promise<void> {
  const existing = await dbInternal.customFieldDefinition.findFirst({ where: { id, orgId } });
  if (!existing) throw new NotFoundError("Kundenfeld nicht gefunden.");
  await dbInternal.customFieldDefinition.delete({ where: { id } });
}

/**
 * Setzt die Reihenfolge aller Kundenfeld-Definitionen einer Organisation neu
 * (Drag&Drop). `ids` muss GENAU die vorhandene Menge enthalten — analog zu
 * reorderDunningStages, aber ohne Zweiphasen-Trick: sortOrder traegt keinen
 * Unique-Index, eine Zwischenzuweisung kann daher nicht kollidieren.
 */
export async function reorderCustomFields(orgId: string, rawInput: unknown): Promise<void> {
  const { ids } = customFieldsReorderSchema.parse(rawInput);
  const existing = await dbInternal.customFieldDefinition.findMany({ where: { orgId }, select: { id: true } });
  const existingIds = new Set(existing.map((d) => d.id));
  const inputIds = new Set(ids);
  if (ids.length !== existing.length || existingIds.size !== inputIds.size || ids.some((id) => !existingIds.has(id))) {
    throw new InvalidOperationError("ids muss genau die vorhandenen Kundenfeld-Ids der Organisation enthalten.");
  }
  await dbInternal.$transaction(ids.map((id, index) => dbInternal.customFieldDefinition.update({ where: { id }, data: { sortOrder: index } })));
}

/**
 * Liest die Kundenfeld-Werte eines Kunden (rohes JSON) und validiert sie GEGEN JEDE
 * bekannte Definition (aktiv oder nicht) EINZELN, statt strikt als Ganzes — Werte zu
 * inzwischen geloeschten Definitionen (Key nicht mehr vorhanden) werden dabei still
 * uebergangen, ein defekter Einzelwert blockiert nicht die uebrigen Felder.
 */
export async function parseCustomerCustomFields(orgId: string, json: string | null): Promise<Record<string, unknown>> {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const definitions = await listCustomFieldDefinitions(orgId);
  const result: Record<string, unknown> = {};
  for (const def of definitions) {
    const value = (raw as Record<string, unknown>)[def.key];
    if (value === undefined) continue;
    const singleFieldSchema = customFieldValuesSchema([{ ...toLike(def), required: false }]);
    const parsed = singleFieldSchema.safeParse({ [def.key]: value });
    if (parsed.success && parsed.data[def.key] !== undefined) {
      result[def.key] = parsed.data[def.key];
    }
  }
  return result;
}

/**
 * Validiert `raw` STRIKT gegen die aktiven Definitionen (unbekannte Keys/Tippfehler
 * werden abgelehnt, siehe customFieldValuesSchema) und speichert das Ergebnis als JSON
 * auf dem Kunden.
 */
export async function setCustomerCustomFields(orgId: string, customerId: string, raw: unknown) {
  const customer = await dbInternal.customer.findFirst({ where: { id: customerId, orgId } });
  if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
  const definitions = (await listCustomFieldDefinitions(orgId, { activeOnly: true })).map(toLike);
  const schema = customFieldValuesSchema(definitions);
  const validated = schema.parse(raw);
  return dbInternal.customer.update({
    where: { id: customerId },
    data: { customFieldsJson: JSON.stringify(validated) },
  });
}
