/**
 * Zod-Schemas der Kundendomain (Phase 8a, Task 1) — Adressen (§29), Ansprechpartner
 * (§30), benutzerdefinierte Kundenfelder (§31) und Kundenvorgaben (§28). Analog zu
 * src/schemas/settings.ts: die Domain-Funktionen (src/domain/customer/*) parsen ihre
 * Eingabe selbst — kein Bypass ueber Route, UI oder MCP (Lastenheft 50/55).
 */
import { z } from "zod";

export const AddressType = z.enum(["BILLING", "SHIPPING", "OTHER"]);
export type AddressType = z.infer<typeof AddressType>;

export const customerAddressInputSchema = z.object({
  type: AddressType,
  label: z.string().max(60).optional(),
  addressLine1: z.string().min(1).max(120),
  addressLine2: z.string().max(120).optional(),
  postalCode: z.string().min(1).max(12),
  city: z.string().min(1).max(80),
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/, "countryCode muss aus 2 Grossbuchstaben bestehen (ISO 3166-1 alpha-2).")
    .default("DE"),
  isDefault: z.boolean().default(false),
});
export type CustomerAddressInput = z.infer<typeof customerAddressInputSchema>;

export const contactPersonInputSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  role: z.string().max(60).optional(),
  phone: z.string().max(40).optional(),
  mobile: z.string().max(40).optional(),
  email: z.email().optional(),
  isDefault: z.boolean().default(false),
});
export type ContactPersonInput = z.infer<typeof contactPersonInputSchema>;

// ── Benutzerdefinierte Kundenfelder (§31) ───────────────────────────────────

export const CustomFieldType = z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]);
export type CustomFieldType = z.infer<typeof CustomFieldType>;

// key: Objektschluessel in Customer.customFieldsJson — mit Kleinbuchstaben beginnend,
// danach Kleinbuchstaben/Ziffern/Unterstrich, Gesamtlaenge 2..40 Zeichen.
const CUSTOM_FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

export const customFieldDefinitionInputSchema = z
  .object({
    key: z.string().regex(CUSTOM_FIELD_KEY_RE, "key muss mit einem Kleinbuchstaben beginnen und darf nur a-z, 0-9, _ enthalten (2-40 Zeichen)."),
    label: z.string().min(1).max(60),
    type: CustomFieldType,
    options: z.array(z.string().min(1)).min(1).max(50).optional(),
    required: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === "SELECT" && (!v.options || v.options.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "SELECT-Felder benoetigen mindestens eine Option." });
    }
    if (v.type !== "SELECT" && v.options !== undefined) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "options sind nur bei type SELECT zulaessig." });
    }
  });
export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionInputSchema>;

export const customFieldsReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type CustomFieldsReorderInput = z.infer<typeof customFieldsReorderSchema>;

// Minimale Form einer Definition, die customFieldValuesSchema zum Bauen des
// Werte-Schemas braucht — von parseCustomerCustomFields/setCustomerCustomFields mit den
// aus der DB gelesenen CustomFieldDefinition-Zeilen befuellt.
export interface CustomFieldDefinitionLike {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[] | null;
  required: boolean;
}

const NUMBER_DECIMAL_STRING_RE = /^-?\d+(\.\d{1,4})?$/;

/**
 * Baut dynamisch ein Zod-Objekt-Schema fuer die Werte eines Kunden je nach den
 * aktiven CustomFieldDefinition-Zeilen der Organisation. `.strict()`: unbekannte Keys
 * (z. B. aus einer geloeschten Definition oder einem Tippfehler) werden beim SCHREIBEN
 * (setCustomerCustomFields) abgelehnt statt stillschweigend uebernommen. Nit-Fix
 * (Fix-Welle): `deleteCustomFieldDefinition` raeumt das gespeicherte JSON NICHT auf
 * (Betreiber-Ruling, siehe Modulkommentar in src/domain/customer/custom-fields.ts) —
 * verwaiste Keys bleiben stehen, `parseCustomerCustomFields` uebergeht sie beim Lesen
 * still statt sie gegen dieses Schema zu pruefen.
 */
export function customFieldValuesSchema(definitions: CustomFieldDefinitionLike[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of definitions) {
    let fieldSchema: z.ZodTypeAny;
    switch (def.type) {
      case "TEXT":
        fieldSchema = z.string().max(500);
        break;
      case "NUMBER":
        fieldSchema = z.string().regex(NUMBER_DECIMAL_STRING_RE, "Zahl muss ein Dezimal-String mit max. 4 Nachkommastellen sein (kein Float).");
        break;
      case "DATE":
        fieldSchema = z.iso.date();
        break;
      case "BOOLEAN":
        fieldSchema = z.boolean();
        break;
      case "SELECT": {
        const options = def.options ?? [];
        fieldSchema =
          options.length > 0 ? z.enum(options as [string, ...string[]]) : z.never({ message: `Feld "${def.key}" hat keine gueltigen Optionen.` });
        break;
      }
      default:
        fieldSchema = z.never();
    }
    shape[def.key] = def.required ? fieldSchema : fieldSchema.nullable().optional();
  }
  return z.object(shape).strict();
}

// ── Kundenvorgaben (§28) ─────────────────────────────────────────────────────

// invoiceCc: kommagetrennte Liste von bis zu 5 E-Mail-Adressen. Leere Segmente
// (doppeltes Komma, fuehrend/nachfolgend) sind ungueltig — dieselbe Praxis wie
// MailSettings.defaultCc, hier zusaetzlich auf 5 begrenzt (Betreiber-Vorgabe).
const emailListSchema = z
  .string()
  .max(500)
  .refine(
    (v) => {
      const parts = v.split(",").map((p) => p.trim());
      if (parts.length > 5) return false;
      return parts.every((p) => z.email().safeParse(p).success);
    },
    { message: "invoiceCc muss eine kommagetrennte Liste von maximal 5 gueltigen E-Mail-Adressen sein." },
  )
  .optional();

export const customerDefaultsInputSchema = z.object({
  defaultCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/, "defaultCurrency muss aus 3 Grossbuchstaben bestehen (ISO 4217).")
    .optional(),
  defaultDiscountPermille: z.number().int().min(0).max(1000).default(0),
  invoiceEmail: z.email().optional(),
  invoiceCc: emailListSchema,
  quoteEmail: z.email().optional(),
  eInvoicePreferred: z.boolean().default(false),
  orderReference: z.string().max(60).optional(),
  deliveryTermsText: z.string().max(2000).optional(),
  paymentTermsText: z.string().max(2000).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/, "language muss aus 2 Kleinbuchstaben bestehen (ISO-639-1).")
    .default("de"),
});
export type CustomerDefaultsInput = z.infer<typeof customerDefaultsInputSchema>;
