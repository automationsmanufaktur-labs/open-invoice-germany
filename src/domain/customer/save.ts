/**
 * Anlegen/Aendern eines Kunden (Contact) — EINZIGE Domain-Funktion fuer Server-Action
 * (`saveCustomer`, src/app/actions/masterdata.ts), MCP-Tools (`upsert_customer`/
 * `update_customer`, src/mcp/tools/customers.ts) und die REST-API (POST/PATCH
 * /api/v1/Contact). Fix-Runde 1 zu Phase 10 Task 2 (Koordinator-Ruling a, 2026-09-04):
 * vorher war dieselbe Anlage-/Aenderungslogik (customerSchema-Feldliste + Nummernkreis
 * + defaultPaymentMethodId-Mandantenpruefung) DREIFACH dupliziert — jetzt einzige Quelle.
 *
 * `updateCustomer` folgt PATCH-Semantik: nur die im `rawInput` TATSAECHLICH vorhandenen
 * Schluessel werden geschrieben (Object.keys(raw)), ungenannte Felder bleiben
 * unveraendert. Ein paar optionale String-Felder werden dabei auf `null` normalisiert,
 * wenn sie als Schluessel vorhanden, aber leer/undefined sind (nullableOnEmpty) — das
 * bildet exakt das bisherige Verhalten der Server-Action nach (ein leeres Formularfeld
 * loescht den bestehenden Wert), waehrend ein Aufrufer, der den Schluessel komplett
 * WEGLAESST (REST-PATCH, MCP `update_customer`), das Feld unangetastet laesst.
 * `customerNumber` wird nur geschrieben, wenn NICHT-leer angegeben (eine bereits
 * vergebene Nummer bleibt sonst beim Speichern anderer Felder erhalten).
 */
import { dbInternal } from "@/lib/db";
import { customerSchema, type CustomerInput } from "@/schemas";
import { assignCustomerNumber } from "@/domain/numbering/ranges";
import { NotFoundError } from "@/domain/errors";
import type { Customer } from "@/generated/prisma/client";

/** defaultPaymentMethodId zeigt auf eine Zahlungsmethode einer ANDEREN Organisation
 *  oder gar nicht existent — Validierungsfehler (400 im API-Kontext), kein Serverfehler. */
export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerValidationError";
  }
}

function toCreateData(v: CustomerInput) {
  return {
    type: v.type,
    name: v.name,
    contactName: v.contactName ?? null,
    addressLine1: v.addressLine1,
    addressLine2: v.addressLine2 ?? null,
    postalCode: v.postalCode,
    city: v.city,
    countryCode: v.countryCode,
    email: v.email || null,
    phone: v.phone ?? null,
    vatId: v.vatId ?? null,
    leitwegId: v.leitwegId ?? null,
    peppolId: v.peppolId ?? null,
    defaultPaymentTermsDays: v.defaultPaymentTermsDays ?? null,
    defaultPaymentMethodId: v.defaultPaymentMethodId ?? null,
    notes: v.notes ?? null,
  };
}

/** G (Fix-Welle Phase 8a/Task 1): defaultPaymentMethodId ungeprueft haette eine
 *  Zahlungsmethode einer FREMDEN Organisation eintragen lassen (Prisma prueft nur
 *  Existenz der ID, nicht orgId). */
async function assertPaymentMethodBelongsToOrg(orgId: string, defaultPaymentMethodId: string | null | undefined): Promise<void> {
  if (!defaultPaymentMethodId) return;
  const method = await dbInternal.paymentMethod.findFirst({ where: { id: defaultPaymentMethodId, orgId }, select: { id: true } });
  if (!method) throw new CustomerValidationError("Zahlungsmethode nicht gefunden.");
}

/** Legt einen neuen Kunden an. Kundennummer per Nummernkreis (CUSTOMER), sofern im
 *  Input nicht bereits gesetzt (§34). */
export async function createCustomer(orgId: string, rawInput: unknown): Promise<Customer> {
  const v = customerSchema.parse(rawInput);
  await assertPaymentMethodBelongsToOrg(orgId, v.defaultPaymentMethodId);
  const data = toCreateData(v);
  return dbInternal.$transaction(async (tx) => {
    const customerNumber = v.customerNumber ?? (await assignCustomerNumber(tx, orgId));
    return tx.customer.create({ data: { ...data, customerNumber, orgId } });
  });
}

const NULLABLE_ON_EMPTY = new Set(["contactName", "addressLine2", "phone", "vatId", "leitwegId", "peppolId", "notes", "defaultPaymentMethodId", "defaultPaymentTermsDays"]);

export async function updateCustomer(orgId: string, id: string, rawInput: unknown): Promise<Customer> {
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const v = customerSchema.partial().parse(raw);

  const existing = await dbInternal.customer.findFirst({ where: { id, orgId } });
  if (!existing) throw new NotFoundError("Kunde nicht gefunden.");

  if ("defaultPaymentMethodId" in raw) {
    await assertPaymentMethodBelongsToOrg(orgId, v.defaultPaymentMethodId);
  }

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!(key in v)) continue;
    let value = (v as Record<string, unknown>)[key];
    if (key === "email") {
      value = value || null;
    } else if (key === "customerNumber") {
      if (!value) continue; // nur schreiben, wenn nicht-leer angegeben
    } else if (NULLABLE_ON_EMPTY.has(key)) {
      value = value ?? null;
    }
    patch[key] = value;
  }
  return dbInternal.customer.update({ where: { id: existing.id }, data: patch });
}
