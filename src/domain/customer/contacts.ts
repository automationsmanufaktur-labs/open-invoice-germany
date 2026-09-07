/**
 * Kunden-Ansprechpartner (Phase 8a, Task 1, §30) — CRUD + Default-Verwaltung, analog zu
 * addresses.ts (siehe dort fuer die Begruendung, warum Loeschen keinen Snapshot-Effekt
 * hat und keine "in Verwendung"-Sperre braucht).
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { contactPersonInputSchema } from "@/schemas";

async function requireCustomer(orgId: string, customerId: string) {
  const customer = await dbInternal.customer.findFirst({ where: { id: customerId, orgId } });
  if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
  return customer;
}

async function requireContact(orgId: string, customerId: string, id: string) {
  const existing = await dbInternal.contactPerson.findFirst({ where: { id, orgId, customerId } });
  if (!existing) throw new NotFoundError("Ansprechpartner nicht gefunden.");
  return existing;
}

/** Alle Ansprechpartner eines Kunden. */
export async function listContacts(orgId: string, customerId: string) {
  await requireCustomer(orgId, customerId);
  return dbInternal.contactPerson.findMany({
    where: { orgId, customerId },
    orderBy: [{ createdAt: "asc" }],
  });
}

/** Legt einen neuen Ansprechpartner an. `isDefault: true` setzt den bisherigen Default zurueck (Tx). */
export async function createContact(orgId: string, customerId: string, rawInput: unknown) {
  await requireCustomer(orgId, customerId);
  const input = contactPersonInputSchema.parse(rawInput);
  return dbInternal.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.contactPerson.updateMany({ where: { orgId, customerId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.contactPerson.create({ data: { orgId, customerId, ...input } });
  });
}

/** Aktualisiert einen bestehenden Ansprechpartner; `isDefault: true` verdraengt den bisherigen Default (Tx). */
export async function updateContact(orgId: string, customerId: string, id: string, rawInput: unknown) {
  await requireCustomer(orgId, customerId);
  await requireContact(orgId, customerId, id);
  const input = contactPersonInputSchema.parse(rawInput);
  return dbInternal.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.contactPerson.updateMany({
        where: { orgId, customerId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.contactPerson.update({ where: { id }, data: input });
  });
}

/** Loescht einen Ansprechpartner. Kein Snapshot-Effekt, keine "in Verwendung"-Sperre. */
export async function deleteContact(orgId: string, customerId: string, id: string): Promise<void> {
  await requireCustomer(orgId, customerId);
  await requireContact(orgId, customerId, id);
  await dbInternal.contactPerson.delete({ where: { id } });
}

/** Setzt einen Ansprechpartner als Default; verdraengt den bisherigen Default (Tx). */
export async function setDefaultContact(orgId: string, customerId: string, id: string) {
  await requireCustomer(orgId, customerId);
  await requireContact(orgId, customerId, id);
  return dbInternal.$transaction(async (tx) => {
    await tx.contactPerson.updateMany({ where: { orgId, customerId, isDefault: true }, data: { isDefault: false } });
    return tx.contactPerson.update({ where: { id }, data: { isDefault: true } });
  });
}

/** Der Default-Ansprechpartner eines Kunden, oder null. */
export async function defaultContactFor(orgId: string, customerId: string) {
  return dbInternal.contactPerson.findFirst({ where: { orgId, customerId, isDefault: true } });
}
